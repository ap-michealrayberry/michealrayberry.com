import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_ORIGIN } from '../../scripts/lib/common.mjs';
import { urlsForChange, collectUrls, isPrivatePath } from '../../scripts/lib/url-map.mjs';
import { parseNameStatus } from '../../scripts/collect-changed-urls.mjs';

const O = SITE_ORIGIN;

test('daily page modification maps to its canonical URL', () => {
  assert.deepEqual(
    urlsForChange('daily/2026-08-02-day-014/index.html'),
    [`${O}/daily/2026-08-02-day-014/`],
  );
});

test('a new daily page maps the same way (status-independent)', () => {
  const urls = collectUrls([{ status: 'A', path: 'daily/2026-08-03-day-015/index.html' }]);
  assert.deepEqual(urls, [`${O}/daily/2026-08-03-day-015/`]);
});

test('a deleted daily page still yields its former public URL', () => {
  const urls = collectUrls([{ status: 'D', path: 'daily/2026-08-02-day-014/index.html' }]);
  assert.deepEqual(urls, [`${O}/daily/2026-08-02-day-014/`]);
});

test('original photograph addition maps to owning page, image sitemap, and the file', () => {
  const urls = urlsForChange('photos/2026/08/02/micheal-ray-berry-day-014-left-2026-08-02.jpg');
  assert.ok(urls.includes(`${O}/daily/2026-08-02-day-014/`));
  assert.ok(urls.includes(`${O}/sitemap-images.xml`));
  assert.ok(urls.includes(`${O}/photos/2026/08/02/micheal-ray-berry-day-014-left-2026-08-02.jpg`));
  // A non-front photo is not the video thumbnail.
  assert.ok(!urls.includes(`${O}/sitemap-videos.xml`));
});

test('front photograph with a video is also the video thumbnail', () => {
  const manifestsByDate = new Map([['2026-08-02', { media: { video: { url: 'https://x/v.mp4' } } }]]);
  const urls = urlsForChange('photos/2026/08/02/micheal-ray-berry-day-014-front-2026-08-02.jpg', { manifestsByDate });
  assert.ok(urls.includes(`${O}/sitemap-videos.xml`));
});

test('responsive image modification maps to owning page and image sitemap only', () => {
  const urls = urlsForChange('media/responsive/2026/08/02/micheal-ray-berry-day-014-front-2026-08-02-960.webp');
  assert.deepEqual(new Set(urls), new Set([`${O}/daily/2026-08-02-day-014/`, `${O}/sitemap-images.xml`]));
});

test('manifest modification fans out to day, aggregates, week, and milestones', () => {
  const urls = urlsForChange('manifests/2026-08-02.json');
  for (const expected of [
    `${O}/daily/2026-08-02-day-014/`, `${O}/daily/`, `${O}/feed.xml`,
    `${O}/sitemap-daily.xml`, `${O}/sitemap-images.xml`, `${O}/sitemap-videos.xml`,
    `${O}/weeks/week-02/`, `${O}/milestones/300-lb/`, `${O}/milestones/175-lb/`,
  ]) assert.ok(urls.includes(expected), `missing ${expected}`);
});

test('weekly page modification maps to the week URL', () => {
  assert.deepEqual(urlsForChange('weeks/week-02/index.html'), [`${O}/weeks/week-02/`]);
});

test('sitemap and feed modifications map to their own URLs', () => {
  assert.deepEqual(urlsForChange('sitemap-daily.xml'), [`${O}/sitemap-daily.xml`]);
  assert.deepEqual(urlsForChange('sitemap.xml'), [`${O}/sitemap.xml`]);
  assert.deepEqual(urlsForChange('feed.xml'), [`${O}/feed.xml`]);
});

test('homepage change maps to the site root', () => {
  assert.deepEqual(urlsForChange('index.html'), [`${O}/`]);
});

test('a renamed file yields both the old (removed) and new URLs', () => {
  const changed = parseNameStatus('R100\tdaily/2026-08-02-day-014/index.html\tdaily/2026-08-03-day-015/index.html');
  const urls = collectUrls(changed);
  assert.deepEqual(urls, [`${O}/daily/2026-08-02-day-014/`, `${O}/daily/2026-08-03-day-015/`]);
});

test('unrelated private files are never emitted', () => {
  assert.ok(isPrivatePath('verify/index.html'));
  assert.ok(isPrivatePath('mrb/inspection/index.html'));
  assert.ok(isPrivatePath('ap/index.html'));
  assert.deepEqual(urlsForChange('verify/index.html'), []);
  assert.deepEqual(urlsForChange('mrb/inspection/index.html'), []);
  assert.deepEqual(urlsForChange('scripts/generate.mjs'), []);
});

test('duplicate URLs are eliminated and results are sorted', () => {
  const urls = collectUrls([
    { status: 'M', path: 'daily/2026-08-02-day-014/index.html' },
    { status: 'M', path: 'daily/2026-08-02-day-014/index.html' },
    { status: 'M', path: 'daily/index.html' },
  ]);
  assert.deepEqual(urls, [`${O}/daily/`, `${O}/daily/2026-08-02-day-014/`]);
});

test('every mapped URL is on the canonical origin', () => {
  const urls = collectUrls([
    { status: 'M', path: 'manifests/2026-08-02.json' },
    { status: 'M', path: 'photos/2026/08/02/micheal-ray-berry-day-014-front-2026-08-02.jpg' },
  ]);
  const host = new URL(O).host;
  for (const u of urls) assert.equal(new URL(u).host, host);
});

test('parseNameStatus handles added, modified, and deleted lines', () => {
  const changed = parseNameStatus('A\tdaily/a/index.html\nM\tsitemap.xml\nD\tfeed.xml');
  assert.deepEqual(changed, [
    { status: 'A', path: 'daily/a/index.html' },
    { status: 'M', path: 'sitemap.xml' },
    { status: 'D', path: 'feed.xml' },
  ]);
});
