// Run: node --test src/shared/websiteExtras.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  facebookEmbedSrc, hasFeeds, instagramProfileUrl, readConsent, safeSitePath, saveConsent, validGaId, xTimelineHref,
} from './websiteExtras.js'

test('Facebook page becomes the page plugin address', () => {
  const src = facebookEmbedSrc('https://www.facebook.com/rotary')
  assert.ok(src.startsWith('https://www.facebook.com/plugins/page.php?'))
  assert.equal(new URL(src).searchParams.get('href'), 'https://www.facebook.com/rotary')
})

test('anything else is refused', () => {
  assert.equal(facebookEmbedSrc('https://evil.com/x'), null)
  assert.equal(facebookEmbedSrc('javascript:alert(1)'), null)
  assert.equal(instagramProfileUrl('a/b'), null)
  assert.equal(xTimelineHref('way_too_long_for_x_name'), null)
  assert.equal(validGaId("G-1');alert(1);//"), null)
})

test('Instagram, X and analytics values', () => {
  assert.equal(instagramProfileUrl('rotary.intl'), 'https://www.instagram.com/rotary.intl')
  assert.equal(xTimelineHref('rotary'), 'https://twitter.com/rotary')
  assert.equal(validGaId('G-ABC1234'), 'G-ABC1234')
})

test('feeds present only when one is set', () => {
  const none = { facebookPageUrl: null, instagramUsername: null, xUsername: null, gaMeasurementId: 'G-ABC1234' }
  assert.equal(hasFeeds(none), false)
  assert.equal(hasFeeds({ ...none, xUsername: 'rotary' }), true)
  assert.equal(hasFeeds(null), false)
})

test('search result links stay on the site', () => {
  assert.equal(safeSitePath('/project?pid=1&yearId=2'), '/project?pid=1&yearId=2')
  assert.equal(safeSitePath('//evil.com'), null)
  assert.equal(safeSitePath('https://evil.com'), null)
  assert.equal(safeSitePath(null), null)
})

test('consent survives blocked storage', () => {
  const mem = new Map()
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
  assert.equal(readConsent(storage), null)
  saveConsent(storage, 'all')
  assert.equal(readConsent(storage), 'all')
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(readConsent(blocked), null)
  saveConsent(blocked, 'all')
})
