import { matchPattern } from 'url-matcher'
import { pick } from 'accept-language-parser'

import config from './config.js'

// Create a new cache instance
const CACHE = caches.default

// Set cache expiration (e.g., 1 hour)
const CACHE_EXPIRATION = 60 * 60

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event))
})

async function handleRequest(event) {
  const request = event.request
  const url = new URL(request.url)

  // Detect the language
  const detectedLanguage = detectLanguage(request)

  // Detect the country from Cloudflare's CF property
  const country = request.cf && request.cf.country ? request.cf.country : null

  // Parse cookies
  const cookies = parseCookies(request.headers.get('Cookie') || '')
  let currency = cookies.woocs_curr
  const cookieExists = !!currency // Flag to check if cookie exists

  // If 'woocs_curr' cookie is not set, determine it based on the country
  if (!currency && country) {
    currency = mapCountryToCurrency(country)
    // Proceed to set the cookie in the response later
  }

  // Check cache first
  const cacheKey = new Request(`${url.toString()}:${detectedLanguage}`, request)
  const cachedResponse = await CACHE.match(cacheKey)

  if (cachedResponse) {
    // If 'woocs_curr' needs to be set (i.e., cookie didn't exist), modify the cached response to include the cookie
    if (currency && !cookieExists) {
      const modifiedResponse = new Response(cachedResponse.body, cachedResponse)
      modifiedResponse.headers.append(
        'Set-Cookie',
        `woocs_curr=${currency}; Path=/; Max-Age=86400; Secure; SameSite=Lax`,
      )
      return modifiedResponse
    }
    return cachedResponse
  }

  // If not in cache, proceed with the original logic
  const response = await handler(event, detectedLanguage)

  // If 'woocs_curr' needs to be set, clone and modify the response
  let finalResponse = response
  if (currency && !cookieExists) {
    finalResponse = new Response(response.body, response)
    finalResponse.headers.append(
      'Set-Cookie',
      `woocs_curr=${currency}; Path=/; Max-Age=86400; Secure; SameSite=Lax`,
    )
    // Optionally cache the response with the currency
    event.waitUntil(CACHE.put(cacheKey, finalResponse.clone()))
  }

  // Cache the response if it's a redirect
  if (response.status === 302) {
    event.waitUntil(CACHE.put(cacheKey, response.clone()))
  }

  return finalResponse
}

function detectLanguage(request) {
  const headers = request.headers

  if (!headers.has('Accept-Language')) {
    return config.default_language
  }

  let header = headers.get('Accept-Language')
  let language = pick(config.supported_languages, header)

  if (!language || language === config.default_language) {
    header = header.replace(/([a-zA-Z]{2})-[a-zA-Z]{2}/, '$1')
    language = pick(config.supported_languages, header)
  }

  console.log(
    'Lang: ' +
      language +
      ' Header:' +
      headers.get('Accept-Language') +
      '|' +
      headers.get('accept-language'),
  )

  return language || config.default_language
}

const handler = async (event, detectedLanguage) => {
  const request = event.request

  // Only run on GET or HEAD requests
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    console.log('Request is non-GET, ignoring.')
    return fetch(request)
  }

  const url = new URL(request.url)

  const mediaRegex = /\.(png|jpeg|jpg|webp|mp4)([?\/].*)?$/i // Matches file extensions for images and videos
  const wpRegex = /^\/wp-/ // Matches URLs that start with /wp-

  if (mediaRegex.test(url.pathname) || wpRegex.test(url.pathname)) {
    return fetch(request)
  }

  // Check if the path is already prefixed when enabled in config.
  if (!config.listen_on_prefixed_paths) {
    const urlArray = url.pathname.split('/')

    if (urlArray.length > 2) {
      const firstPart = urlArray[1]

      if (
        config.supported_languages.some(
          lang => lang.toLowerCase() === firstPart.toLowerCase(),
        )
      ) {
        console.log(
          'The request already has a language prefix (' +
            firstPart +
            '), ignoring.',
        )
        return fetch(request)
      }
    }
  }

  // Whether or not this request should be handled.
  let handleThis = config.listen_on_all_paths

  // Don't use route-matching when listen_on_all_paths is enabled.
  if (!config.listen_on_all_paths) {
    for (const path of config.listen_on_paths) {
      const match = matchPattern(path, url.pathname)

      console.log('Matching ', path, ' against ', url.pathname, match)

      // If there was a match, break from the loop.
      if (match && match.remainingPathname === '') {
        console.log('Match')
        handleThis = true
        break
      }

      console.log('No match')
    }
  }

  // Return if we are not supposed to handle this.
  if (!handleThis) {
    if (config.always_on_not_found) {
      try {
        const res = await fetch(request)
        console.log(res)

        // Redirect if we'd return a 404 otherwise
        if (res.status === 404) {
          console.log('Sub-Request is 404, continuing.')
        } else {
          console.log('Sub-Request is ' + res.status + ', not redirecting.')
          return res
        }
      } catch (e) {
        console.log(e)
        console.log('Sub-Request failed, continuing.')
      }
    } else {
      console.log('Request is not for us, ignoring.')
      return fetch(request)
    }
  }

  if (detectedLanguage === config.default_language) {
    return fetch(request)
  }

  // Do the redirect.
  return redirectWithPrefix(url, detectedLanguage)
}

/**
 * Generate a HTTP response redirecting to a URL, prefixed with a prefix.
 * @param {URL} url The URL the redirect is based on
 * @param {string} prefix The string to prefix 'url' with.
 * @returns {Response} The final response
 */
async function redirectWithPrefix(url, prefix) {
  url.pathname = '/' + prefix + url.pathname

  return new Response(null, {
    status: 302,
    headers: new Headers({
      Location: url.href,
      'Cache-Control': `public, max-age=${CACHE_EXPIRATION}`,
    }),
  })
}

/**
 * Parse cookies from the Cookie header.
 * @param {string} cookieHeader The Cookie header string
 * @returns {Object} An object mapping cookie names to values
 */
function parseCookies(cookieHeader) {
  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const [name, ...rest] = cookie.trim().split('=')
    cookies[name] = rest.join('=')
    return cookies
  }, {})
}

/**
 * Map a country code to its corresponding currency.
 * Cloudflare country code (CF-IPCountry) -> ISO 4217 currency
 * @param {string} countryCode The country code (e.g., 'US', 'AU')
 * @returns {string} The corresponding currency code
 */
function mapCountryToCurrency(countryCode) {
  const countryToCurrency = {
    // Primary currencies
    AU: 'AUD', // Australia
    US: 'USD', // United States
    CA: 'CAD', // Canada
    GB: 'GBP', // United Kingdom
    EU: 'EUR', // Cloudflare's "Europe" pseudo-country

    AE: 'AED', // United Arab Emirates
    AR: 'ARS', // Argentina
    BR: 'BRL', // Brazil
    CH: 'CHF', // Switzerland
    CR: 'CRC', // Costa Rica
    CZ: 'CZK', // Czech Republic
    DK: 'DKK', // Denmark
    ID: 'IDR', // Indonesia
    JP: 'JPY', // Japan
    NZ: 'NZD', // New Zealand
    PL: 'PLN', // Poland
    SA: 'SAR', // Saudi Arabia
    SE: 'SEK', // Sweden
    SG: 'SGD', // Singapore
    VE: 'VEF', // Venezuela
    ZA: 'ZAR', // South Africa

    // Common EUR countries
    AT: 'EUR', // Austria
    BE: 'EUR', // Belgium
    CY: 'EUR', // Cyprus
    DE: 'EUR', // Germany
    EE: 'EUR', // Estonia
    ES: 'EUR', // Spain
    FI: 'EUR', // Finland
    FR: 'EUR', // France
    GR: 'EUR', // Greece
    IE: 'EUR', // Ireland
    IT: 'EUR', // Italy
    LT: 'EUR', // Lithuania
    LU: 'EUR', // Luxembourg
    LV: 'EUR', // Latvia
    MT: 'EUR', // Malta
    NL: 'EUR', // Netherlands
    PT: 'EUR', // Portugal
    SI: 'EUR', // Slovenia
    SK: 'EUR', // Slovakia

    // Extra AUD territories
    CC: 'AUD', // Cocos (Keeling) Islands
    CX: 'AUD', // Christmas Island
    NF: 'AUD', // Norfolk Island

    // Extra USD territories
    AS: 'USD', // American Samoa
    GU: 'USD', // Guam
    MP: 'USD', // Northern Mariana Islands
    PR: 'USD', // Puerto Rico
    UM: 'USD', // U.S. Minor Outlying Islands
    VI: 'USD', // U.S. Virgin Islands
  }

  return getCurrencyFromCountry(
    countryCode,
    countryToCurrency,
    config.default_currency,
  )
}

/**
 * Helper function to get currency from country code.
 * @param {string} cfCountry Cloudflare's country code (e.g. request.cf.country)
 * @param {Object} countryToCurrency The country to currency mapping object
 * @param {string} fallback The fallback currency (defaults to USD)
 * @returns {string} The corresponding currency code
 */
function getCurrencyFromCountry(
  cfCountry,
  countryToCurrency,
  fallback = 'USD',
) {
  const code = (cfCountry || '').toUpperCase()
  return countryToCurrency[code] || fallback
}
