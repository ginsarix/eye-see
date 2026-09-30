import { fileURLToPath } from 'node:url';
import { $, $$, browser, expect } from '@wdio/globals';

const imagesDir = fileURLToPath(new URL('../../src/test/images', import.meta.url));

const expectedMatches = [
  { query: 'a cat wearing sunglasses', fileName: '1_test-image.webp' },
  { query: 'a chimpanzee', fileName: '2_test-image.jpg' },
  { query: 'a labradoodle', fileName: '3_test-image.jpg' },
  { query: 'a shirt with red lines', fileName: '4_test-image.png' },
  { query: '2 men looking at the camera', fileName: '5_test-image.png' },
];

type SearchState = { started: boolean; done: boolean };
type E2EWindow = Window & { __e2eSearch?: SearchState };

async function search(query: string) {
  const input = await $('input[placeholder="describe an image…"]');
  await input.clearValue();
  await input.setValue(query);
  await expect(input).toHaveValue(query);

  // The search button is disabled while a search runs. Watch for it to be
  // disabled and re-enabled, so results from the previous search aren't
  // mistaken for this one's.
  await browser.execute(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Look"]')!;
    const state: SearchState = { started: false, done: false };
    (window as E2EWindow).__e2eSearch = state;

    new MutationObserver((_, observer) => {
      if (button.disabled) {
        state.started = true;
      } else if (state.started) {
        state.done = true;
        observer.disconnect();
      }
    }).observe(button, { attributes: true, attributeFilter: ['disabled'] });
  });

  await $('button[aria-label="Look"]').click();

  await browser.waitUntil(
    () => browser.execute(() => (window as E2EWindow).__e2eSearch?.done ?? false),
    { timeout: 5 * 60_000, interval: 250, timeoutMsg: `Search for "${query}" did not finish` },
  );

  const labels = await $$('button[aria-label^="Preview "]').map((el) =>
    el.getAttribute('aria-label'),
  );
  return labels.map((label) => (label ?? '').replace(/^Preview /, ''));
}

describe('image search', () => {
  before(async () => {
    // Folder selection goes through a native dialog, which WebDriver can't
    // drive. Instead, seed the last-used directory that the app restores on load.
    await browser.execute((dir) => localStorage.setItem('directory', dir), imagesDir);
    await browser.refresh();

    await expect($(`p[title="${imagesDir}"]`)).toBeDisplayed();
    // Searching stays disabled until Rust has loaded the model
    await browser.waitUntil(() => $('button[aria-label="Look"]').isEnabled(), {
      timeout: 10 * 60_000,
      interval: 1_000,
      timeoutMsg: 'The CLIP model did not finish loading',
    });
  });

  for (const { query, fileName } of expectedMatches) {
    it(`ranks ${fileName} first for "${query}"`, async () => {
      const results = await search(query);

      expect(results).toHaveLength(expectedMatches.length);
      expect(results[0]).toBe(fileName);
      await expect($('footer')).toHaveText(`Files processed ${expectedMatches.length}`, {
        containing: true,
      });
    });
  }

  it('shows a thumbnail for every result', async () => {
    await search(expectedMatches[0].query);

    const thumbnails = $$('ul[aria-label="Search results"] img');
    await expect(thumbnails).toBeElementsArrayOfSize(expectedMatches.length);
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Array.from(
            document.querySelectorAll<HTMLImageElement>('ul[aria-label="Search results"] img'),
          ).every((img) => img.complete && img.naturalWidth > 0),
        ),
      { timeout: 10_000, timeoutMsg: 'Result thumbnails did not load' },
    );
  });

  it('opens a result in a preview dialog and closes it with Escape', async () => {
    const { query, fileName } = expectedMatches[1];
    await search(query);

    const thumbnail = $(`button[aria-label="Preview ${fileName}"]`);
    // Thumbnails stay disabled until their image has loaded
    await thumbnail.waitForEnabled();
    await thumbnail.click();

    const dialog = $('dialog[open]');
    await expect(dialog).toBeDisplayed();
    await expect(dialog.$('h2')).toHaveText(fileName);
    await browser.waitUntil(
      () =>
        browser.execute(
          () => (document.querySelector<HTMLImageElement>('dialog img')?.naturalWidth ?? 0) > 0,
        ),
      { timeout: 10_000, timeoutMsg: 'Preview image did not load' },
    );

    await browser.keys('Escape');
    await expect($('dialog')).not.toBeExisting();
  });
});
