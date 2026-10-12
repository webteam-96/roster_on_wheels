// A valid web URL must start with http:// or https:// and end with a recognised TLD
// (e.g. https://example.com, https://rotary.in). To allow more endings, add them to the
// (?:com|net|...) group. Keep in sync with the API copy in RotaryApi/Services/UrlValidator.cs.
const WEB_URL = /^https?:\/\/(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:com|net|org|edu|gov|mil|int|info|biz|name|pro|online|site|store|tech|cloud|page|club|live|news|blog|asia|app|dev|xyz|mobi|io|ai|me|tv|us|uk|au|ca|sg|ae|np|lk|bd|pk|eu|be|ly|gl|cc|ws|gg|fm|to|sh|im|in|co)(?::\d{1,5})?(?:\/[^\s]*)?$/i;

export function isValidWebUrl(url: string | null | undefined): boolean {
  return !!url && WEB_URL.test(url.trim());
}

export const INVALID_URL_MESSAGE =
  "Enter a valid URL with http:// or https:// and a real domain ending such as .com or .in (e.g. https://example.com).";
