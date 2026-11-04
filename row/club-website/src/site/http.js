// Port of Library/Api/ApiClient.cs — one shared client, and calls that degrade
// gracefully: GetOrNull/GetOrEmpty swallow every error so a page always renders.
import axios from 'axios'
import { appSettings } from './config.js'

// ROW serves the same routes under /api. On the server, INTERNAL_API_URL (when set) avoids the public hop.
const base = typeof window === 'undefined' && process.env.INTERNAL_API_URL
  ? process.env.INTERNAL_API_URL.replace(/\/+$/, '')
  : appSettings.ApiBaseUrl

export const http = axios.create({
  baseURL: base + '/api',
  headers: { Accept: 'application/json' },
  timeout: 10000,
})

/** GET → data, or null on 204 / any failure. */
export async function getOrNull(url, config) {
  try {
    const res = await http.get(url, config)
    if (res.status === 204) return null
    return res.data === undefined ? null : res.data
  } catch {
    return null
  }
}

/** GET → array (never null), for list endpoints. */
export async function getOrEmpty(url, config) {
  const data = await getOrNull(url, config)
  return Array.isArray(data) ? data : []
}
