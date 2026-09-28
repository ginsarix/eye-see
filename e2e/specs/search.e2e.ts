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
  const input = await $('input[placeholder="Query"]');
  await input.clearValue();
  await input.setValue(query);
  await expect(input).toHaveValue(query);

  // The search button is disabled while a search runs. Watch for it to be
  // disabled and re-enabled, so results from the previous search aren't
  // mistaken for this one's.
  await browser.execute(() => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!;
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

  await $('button[aria-label="Search"]').click();

  await browser.waitUntil(
    () => browser.execute(() => (window as E2EWindow).__e2eSearch?.done ?? false),
    { timeout: 5 * 60_000, interval: 250, timeoutMsg: `Search for "${query}" did not finish` },
  );

  const results = await $$('p*=File name:').map((el) => el.getText());
  return results.map((text) => /^File name: (.+) Score: /.exec(text)![1]);
}

describe('image search', () => {
  before(async () => {
    // Folder selection goes through a native dialog, which WebDriver can't
    // drive. Instead, seed the last-used directory that the app restores on load.
    await browser.execute((dir) => localStorage.setItem('directory', dir), imagesDir);
    await browser.refresh();

    await expect($(`p=Selected: ${imagesDir}`)).toBeDisplayed();
    // Searching stays disabled until the model has downloaded and is ready
    await browser.waitUntil(() => $('button[aria-label="Search"]').isEnabled(), {
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
      await expect($(`p=Files processed: ${expectedMatches.length}`)).toBeDisplayed();
    });
  }
});
