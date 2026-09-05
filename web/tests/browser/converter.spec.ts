import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';

const fixture = path.resolve(import.meta.dirname, '../../../assets/test.mid');
const playbackFixtures = [fixture];
const shortTempoMidi = Buffer.from([
  0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72,
  0x6b, 0, 0, 0, 36, 0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0xc0, 0, 0, 0x90,
  60, 100, 120, 0x80, 60, 0, 0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40, 0, 0x90, 62,
  100, 120, 0x80, 62, 0, 0, 0xff, 0x2f, 0,
]);

test('has no serious or critical accessibility violations', async ({
  page,
}) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
});

test('keeps the primary workflow usable on a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose MIDI' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Convert', exact: true }),
  ).toBeVisible();
  let overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 812, height: 375 });
  overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('keeps the current project identity until a selected replacement is converted', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByRole('button', { name: 'Convert', exact: true }).click();

  const replacementChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose MIDI' }).click();
  await (
    await replacementChooser
  ).setFiles({
    name: 'replacement.mid',
    mimeType: 'audio/midi',
    buffer: shortTempoMidi,
  });
  await expect(
    page.getByText('replacement.mid is ready to convert'),
  ).toBeVisible();

  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project' }).click();
  const download = await projectDownload;
  expect(download.suggestedFilename()).toBe('test.reve-midi.json');
  const projectPath = await download.path();
  const document = JSON.parse(
    await (await import('node:fs/promises')).readFile(projectPath!, 'utf8'),
  );
  expect(document.source.name).toBe('test.mid');

  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(
    page.getByText('replacement.mid', { exact: true }),
  ).toBeVisible();
});

test('resets playback state before showing a replacement conversion', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  const replacementChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose MIDI' }).click();
  await (
    await replacementChooser
  ).setFiles({
    name: 'replacement.mid',
    mimeType: 'audio/midi',
    buffer: shortTempoMidi,
  });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByLabel('Playback position')).toBeDisabled();
  await expect(page.getByText('Audio idle', { exact: true })).toBeVisible();
});

test('aligns tracks regardless of which track is selected first', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Convert', exact: true }),
  ).toBeEnabled();

  const trackButtons = page
    .getByRole('button')
    .filter({ hasText: /converted notes/ });
  await trackButtons.nth(1).click();
  await page.getByRole('button', { name: 'Align with partner track' }).click();

  await expect(
    page.getByRole('button', { name: 'Convert', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('keeps note remapping after conversion settings change', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'remap.mid',
    mimeType: 'audio/midi',
    buffer: shortTempoMidi,
  });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Convert', exact: true }),
  ).toBeEnabled();

  const output = page.getByRole('textbox', {
    name: 'Converted MML code',
    exact: true,
  });
  const original = await output.inputValue();
  await page.getByRole('button', { name: 'Remap notes' }).click();
  await page.getByLabel('Note mapping in JSON format').fill('{"60":72}');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => output.inputValue()).not.toBe(original);
  const remapped = await output.inputValue();

  await page
    .getByRole('slider', { name: /Chord grouping/ })
    .press('ArrowRight');
  await expect.poll(() => output.inputValue()).toBe(remapped);
});

test('only offers timing precision values accepted by the converter', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'timing.mid',
    mimeType: 'audio/midi',
    buffer: shortTempoMidi,
  });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const precision = page.getByRole('combobox', { name: 'Timing precision' });
  await expect(precision.locator('option')).toHaveText([
    '1/16',
    '1/32',
    '1/64',
    '1/128',
  ]);
  await precision.selectOption('128');
  await expect(
    page.getByRole('button', { name: 'Convert', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('converts, edits, highlights, exports, and restores a MIDI project', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByText('Processed locally in your browser'),
  ).toBeVisible();

  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  const conversionStarted = Date.now();
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(page.getByText('Converted', { exact: true })).toBeVisible();
  expect(Date.now() - conversionStarted).toBeLessThan(15_000);
  await expect(page.getByRole('alert')).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept('Lead track'));
  await page.getByRole('button', { name: 'Rename selected track' }).click();
  await expect(
    page.getByText('Lead track', { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Remap notes' }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('button', { name: 'Remap notes' }).click();
  await expect(page.getByLabel('Note mapping in JSON format')).toHaveValue(
    /"60": 72/,
  );
  await page.getByRole('button', { name: 'Cancel' }).click();

  const projectDownload = page.waitForEvent('download');
  await page.getByTitle('Save project').click();
  const download = await projectDownload;
  await expect(download.suggestedFilename()).toMatch(/\.reve-midi\.json$/);
  const projectPath = await download.path();
  expect(projectPath).toBeTruthy();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear local data' }).click();
  await page.locator('input[type="file"]').nth(1).setInputFiles(projectPath!);
  await expect(
    page.getByText('Lead track', { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(
    page.getByLabel('Converted MML code with playback highlighting'),
  ).toBeVisible();
  await expect(
    page.getByText('Studio instruments', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();

  await page.reload();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Converted', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Lead track', { exact: true }).first(),
  ).toBeVisible();
});

test('clears persisted data without changing the open project settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByRole('button', { name: 'Convert', exact: true }).click();

  await page
    .getByRole('slider', {
      name: 'Note intensity. Sets the minimum and maximum strength of converted notes. minimum',
      exact: true,
    })
    .press('ArrowRight');
  await expect(page.getByText('1 - 15', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Convert', exact: true }),
  ).toBeEnabled();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear local data' }).click();
  await expect(page.getByText('1 - 15', { exact: true })).toBeVisible();
});

test('starts and stops SoundFont playback for every golden MIDI fixture', async ({
  page,
}) => {
  await page.goto('/');
  for (const midiPath of playbackFixtures) {
    await page.locator('input[type="file"]').first().setInputFiles(midiPath);
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(page.getByText('Converted', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(
      page.getByText('Studio instruments', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel('Converted MML code with playback highlighting'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Stop' }).click();
  }
});

test('finishes a short tempo-changing song and returns to a stopped state', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'short-tempo.mid',
    mimeType: 'audio/midi',
    buffer: shortTempoMidi,
  });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(
    page.getByText('Studio instruments', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({
    timeout: 15_000,
  });
});

test('stops, seeks, and replays without retaining the previous synthesizer', async ({
  page,
}) => {
  let soundFontRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/soundfonts/generaluser-gs.sf2'))
      soundFontRequests += 1;
  });
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByRole('button', { name: 'Convert', exact: true }).click();

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(
    page.getByText('Studio instruments', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('00:00', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(
    page.getByText('Studio instruments', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(soundFontRequests).toBe(1);

  await page
    .locator('footer [data-slot="slider-thumb"]')
    .first()
    .waitFor({ state: 'visible' });
  await page.getByLabel('Playback position').press('End');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
});

test('presents basic audio fallback as a warning instead of a failed conversion', async ({
  page,
}) => {
  await page.route('**/soundfonts/generaluser-gs.sf2', (route) =>
    route.abort(),
  );
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByText('Simple tones', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Studio instruments could not load',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop' }).click();
});

test('reports invalid MIDI without crashing the worker UI', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'broken.mid',
      mimeType: 'audio/midi',
      buffer: Buffer.from('not a midi file'),
    });
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Something went wrong');

  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(page.getByText('Converted', { exact: true })).toBeVisible();
});
