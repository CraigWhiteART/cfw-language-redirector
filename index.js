import { matchPattern } from 'url-matcher'
import { pick } from 'accept-language-parser'

import config from './config.js'

addEventListener('fetch', (event) => event.respondWith(handler(event)))

const handler = async event => {
  const request = event.request

  // Only run on GET or HEAD requests
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    console.log('Request is non-GET, ignoring.')
    return fetch(request)
  }

  const url = new URL(request.url)

  // Check if the path is already prefixed when enabled in config.
  if (!config.listen_on_prefixed_paths) {
    const urlArray = url.pathname.split('/')

    // Ignore if the url has no first part e.g. /
    if (urlArray.length > 2) {
      const firstPart = urlArray[1]

      let hasLanguage = false

      for (const i in config.supported_languages) {
        const language = config.supported_languages[i]

        // If there was a match, break from the loop.
        if (language.toLowerCase() === firstPart.toLowerCase()) {
          hasLanguage = true
          break
        }
      }

      // Return if a language was found.
      if (hasLanguage) {
        console.log('The request already has a language prefix ('+firstPart+'), ignoring.')
        return fetch(request)
      }
    }
  }

  // Weather or not this request should be handled.
  let handleThis = config.listen_on_all_paths

  // Don't use route-matching when listen_on_all_paths is enabled.
  if (!config.listen_on_all_paths) {
    for (const i in config.listen_on_paths) {
      const path = config.listen_on_paths[i]

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

    if(config.always_on_not_found) {
      try {
        const res = await fetch(request)
        console.log(res)
    
        // Redirect if we'd return a 404 otherwise
        if(res.status === 404) {
          console.log('Sub-Request is 404, continuing.')
        } else {
          console.log('Sub-Request is '+res.status+', not redirecting.')
          return fetch(request)
        }
      } catch(e) {
        console.log(e);
        console.log('Sub-Request failed, continuing.')
      }
    } else {
      console.log('Request is not for us, ignoring.')
      return fetch(request)
    }
  }

  const headers = request.headers

  // Use default language if no Accept-Language Header was sent by the client.
  if (!headers.has('Accept-Language')) {
    return fetch(request);
    //return redirectWithPrefix(url, config.default_language)
  }

  let header = headers.get('Accept-Language');
  let language = pick(
    config.supported_languages,
    header
  )
  if(!language || language == config.default_language){
    header = header.replace(/([a-zA-Z]{2})-[a-zA-Z]{2}/, '$1');
    language = parser.pick(
      config.supported_languages,
      header
    )
  }

  console.log('Lang: ' + language + " Header:" + headers.get('Accept-Language') + "|" + headers.get('accept-language'));

  // If accept-language-parser didn't manage to find a supported language, use the default one.
  if (!language) {
    language = config.default_language
  }
  if(language == config.default_language){
    return fetch(request);
  }

  // Do the redirect.
  return redirectWithPrefix(url, language)
}

/**
 * Generate a HTTP response redirecting to a URL, prefixed with a prefix.
 * @param {URL} url The URL the redirect is based on
 * @param {string} prefix The string to prefix 'url' with.
 * @returns {Response} The final response
 */
async function redirectWithPrefix (url, prefix) {
  url.pathname = '/' + prefix + url.pathname

  return new Response(null, {
    status: 302,
    headers: new Headers({
      Location: url.href
    })
  })
}
