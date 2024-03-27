module.exports = {
  // The following is the default language the redirector will redirect to when no other language is found.
  default_language: 'en',
  // The following is a list of supported languages.
  supported_languages: ['de', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ro', 'hu', 'lt', 'pl', 'en' ],
  // The following is an array of paths the redirector should handle request for.
  // Those can be literal paths (/foo/bar), paths with placeholders (/foo/*.bar) or paths with wildcards (/foo/**)
  listen_on_paths: [ "/*" ],
//   listen_on_paths: [{
//   pattern: 'content/:pageName',
//   rules: {
//     pageName: {
//       regex: '^(?!.*\\.(jpg|png|webp)$).*',
//       convert: (v) => v,
//       validate: (v) => !/\.(jpg|png|webp)$/.test(v)
//     }
//   }
// }],
  // This sets the worker to listen on all paths not prefixed with a language.
  listen_on_all_paths: false,
  // This will always redirect when a 404 would be returned otherwise
  always_on_not_found: false,
  // DANGEROUS: The following sets the worker to run when a path already starts with /[some language]/something. This can lead to infinite redirects. Use responsibly.
  listen_on_prefixed_paths: false
}
