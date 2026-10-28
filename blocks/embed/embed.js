/**
 * Embed Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-014 (.eds-pipeline/contracts/embed.md)
 * Base: Adobe Block Collection (embed) @ commit 5ad878ba, adapted: the video opens in a modal
 *   (decision R8) instead of loading in place, plus an optional title over the thumbnail.
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - Placeholders read as written and in camelCase (closeDialog was never read).
 * - Universal Editor fallback instrumentation (instrumentBlock): only when AEM has not
 *   instrumented the block, never over the attributes AEM delivers; one resource per block,
 *   also for blocks decorated detached from the document (fragments).
 */

import { toCamelCase } from '../../scripts/aem.js';

/** Rule DH-10: watch, youtu.be, embed or thumbnail (img.youtube.com/vi/<id>/…) URLs. */
const YOUTUBE_ID_PATTERN = /(?:vi\/|embed\/|v=|youtu\.be\/)([\w-]{11})/;

/** YouTube host of the player. */
const VIDEO_ORIGIN = 'https://www.youtube-nocookie.com';

/** The modal opens on a click, so the player starts at once, with sound and controls. */
const VIDEO_PARAMS = 'autoplay=1&rel=0&playsinline=1';

/**
 * Fallback labels, used only when the site placeholders do not define the keys.
 * The site text lives in /placeholders.json (keys playVideo, closeDialog and video).
 */
const DEFAULT_LABELS = {
  playVideo: 'Play video',
  closeDialog: 'Close',
  video: 'Video',
};

/** Labels of the block and its fields in the Universal Editor (fallback instrumentation). */
const UE_LABELS = {
  block: 'Vídeo',
  embed_uri: 'URL del vídeo de YouTube',
  embed_placeholder: 'Miniatura del vídeo',
  title: 'Titular',
};

let placeholdersRequest;

/** Blocks instrumented by the fallback while detached from the document (fragments). */
let detachedCount = 0;

/**
 * Fetches the site placeholders once (/placeholders.json, rows Key/Text) and
 * returns them keyed both as written and in camelCase. Any failure resolves to an
 * empty object.
 * @returns {Promise<Object<string, string>>} placeholders
 */
function fetchPlaceholders() {
  if (!placeholdersRequest) {
    placeholdersRequest = fetch('/placeholders.json')
      .then((response) => (response.ok ? response.json() : {}))
      // [QA] [ANTES] only toCamelCase(Key): it lowercases camelCase keys (closeDialog ->
      // closedialog), so the site texts were never read. [DESPUÉS] as written and camelCase.
      .then((json) => Object.fromEntries((json.data || [])
        .filter((row) => row.Key && row.Text)
        .flatMap((row) => [[toCamelCase(row.Key), row.Text], [row.Key, row.Text]])))
      .catch(() => ({}));
  }
  return placeholdersRequest;
}

/**
 * Extracts the YouTube id from any accepted URL form (rule DH-10).
 * @param {string} value URL written by the author
 * @returns {string|null} the 11-character id, or null
 */
function getYouTubeId(value) {
  const match = (value || '').match(YOUTUBE_ID_PATTERN);
  return match ? match[1] : null;
}

/**
 * Reads the video URL of the embed cell: the link, or the first text paragraph.
 * @param {?Element} cell embed cell
 * @returns {{ source: string, holder: ?Element }} the URL and the node that shows it
 */
function readVideoUrl(cell) {
  if (!cell) return { source: '', holder: null };
  const link = cell.querySelector('a[href]');
  if (link) return { source: link.href, holder: link.closest('p') || link };
  const paragraph = [...cell.querySelectorAll('p')]
    .find((p) => !p.querySelector('picture, img') && p.textContent.trim());
  return { source: paragraph ? paragraph.textContent.trim() : '', holder: paragraph || null };
}

/**
 * Builds the play icon (64px circle with a triangle, as on the portal).
 * @returns {SVGSVGElement} decorative icon
 */
function buildPlayIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'embed-play');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '32');
  circle.setAttribute('cy', '32');
  circle.setAttribute('r', '26.7');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '2.6');
  const triangle = document.createElementNS(ns, 'path');
  triangle.setAttribute('d', 'M26.9 22.7v18.6L43 32z');
  triangle.setAttribute('fill', 'none');
  triangle.setAttribute('stroke', 'currentColor');
  triangle.setAttribute('stroke-width', '2.5');
  triangle.setAttribute('stroke-linejoin', 'round');
  svg.append(circle, triangle);
  return svg;
}

/**
 * Builds the close icon of the modal.
 * @returns {SVGSVGElement} decorative icon
 */
function buildCloseIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M5 5l14 14M19 5L5 19');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  svg.append(path);
  return svg;
}

/**
 * Applies the accessible names (English fallback or site placeholders).
 * @param {HTMLButtonElement} trigger play button
 * @param {HTMLDialogElement} dialog modal
 * @param {string} title authored title, may be empty
 * @param {Object<string, string>} labels playVideo, closeDialog and video texts
 */
function applyLabels(trigger, dialog, title, labels) {
  trigger.setAttribute('aria-label', title ? `${labels.playVideo}: ${title}` : labels.playVideo);
  dialog.setAttribute('aria-label', title || labels.video);
  dialog.querySelector('.embed-modal-close').setAttribute('aria-label', labels.closeDialog);
  const iframe = dialog.querySelector('iframe');
  if (iframe) iframe.title = title ? `${labels.video}: ${title}` : labels.video;
}

/**
 * Locks the page scroll behind the modal. The page root is outside the block, so the
 * block stylesheet cannot reach it: the state goes inline and is restored on close.
 * scrollbar-gutter keeps the scrollbar space, so the page behind does not shift.
 * @param {boolean} locked whether the modal is open
 */
function lockPageScroll(locked) {
  const root = document.documentElement;
  root.style.overflow = locked ? 'hidden' : '';
  root.style.scrollbarGutter = locked ? 'stable' : '';
}

/**
 * Builds the modal: a native <dialog> opened with showModal(), so the page behind is inert
 * and Escape closes it. The player is created when it opens and removed when it closes,
 * so nothing is requested before the click and the video stops on close.
 * @param {string} id YouTube id
 * @param {HTMLButtonElement} trigger play button
 * @param {() => {title: string, labels: Object<string, string>}} getState current texts
 * @returns {HTMLDialogElement} the modal
 */
function buildModal(id, trigger, getState) {
  const dialog = document.createElement('dialog');
  dialog.className = 'embed-modal';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'embed-modal-close';
  close.autofocus = true;
  close.append(buildCloseIcon());
  close.addEventListener('click', () => dialog.close());

  const frame = document.createElement('div');
  frame.className = 'embed-modal-frame';
  dialog.append(close, frame);

  // A click on the backdrop reaches the dialog itself: its content never fills the viewport.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('close', () => {
    // [EDS-COMP-014 §10] Decided by the person (2026-10-28): the video stops on close, as on the
    // portal. The player is removed, so it stops and reopens from the start.
    frame.querySelector('iframe')?.remove();
    lockPageScroll(false);
    trigger.focus();
  });

  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    const { title, labels } = getState();
    const iframe = document.createElement('iframe');
    iframe.src = `${VIDEO_ORIGIN}/embed/${id}?${VIDEO_PARAMS}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.append(iframe);
    applyLabels(trigger, dialog, title, labels);
    lockPageScroll(true);
    dialog.showModal();
  });

  return dialog;
}

/**
 * Loads the site placeholders the first time someone engages with the block (pointer,
 * touch or keyboard focus) and refreshes the labels. The English fallback is in place
 * from the start, so nothing is fetched while the page loads.
 * @param {Element} block the block
 * @param {(labels: Object<string, string>) => void} onLabels receives the final labels
 */
function schedulePlaceholders(block, onLabels) {
  const events = ['pointerenter', 'touchstart', 'focusin'];
  const load = () => {
    events.forEach((name) => block.removeEventListener(name, load));
    fetchPlaceholders().then((placeholders) => {
      const labels = { ...DEFAULT_LABELS };
      Object.keys(labels).forEach((key) => {
        if (placeholders[key]) labels[key] = placeholders[key];
      });
      onLabels(labels);
    });
  };
  events.forEach((name) => block.addEventListener(name, load, { passive: true }));
}

/**
 * Instruments one field for the Universal Editor, unless AEM already did.
 * @param {?Element} element node that shows the field
 * @param {string} prop field name in models[] of _embed.json
 * @param {string} type data-aue-type
 */
function instrumentField(element, prop, type) {
  if (!element || element.dataset.aueProp) return;
  element.dataset.aueProp = prop;
  element.dataset.aueType = type;
  element.dataset.aueLabel = UE_LABELS[prop];
}

/**
 * Universal Editor instrumentation (xwalk). On the author instance AEM delivers the block
 * already instrumented with the real resource of the component: those attributes stay on the
 * nodes decorate() keeps or moves, and are never overwritten. Only a block AEM has not
 * instrumented (local drafts, preview) gets this fallback, with a resource built from the
 * current path and the position of the block in the page.
 * embed_placeholderAlt collapses into the alt of the thumbnail, so it shares its node.
 * An empty field has no node of its own and is edited from the properties panel.
 * @param {Element} block the block
 * @param {{uri: ?Element, image: ?Element, title: ?Element}} nodes nodes per field
 */
function instrumentBlock(block, nodes) {
  if (block.dataset.aueResource) return;
  // One resource per block: Universal Editor looks blocks up by data-aue-resource. A fragment
  // is decorated before it is attached to the document (indexOf is -1), so a detached block
  // gets its own suffix instead of taking the resource of the first block of the page.
  const position = [...document.querySelectorAll('.embed')].indexOf(block);
  const suffix = position >= 0 ? position : `detached-${detachedCount += 1}`;
  block.dataset.aueResource = `urn:aemconnection:${window.location.pathname}#embed-${suffix}`;
  block.dataset.aueType = 'component';
  block.dataset.aueModel = 'embed';
  block.dataset.aueLabel = UE_LABELS.block;

  instrumentField(nodes.uri, 'embed_uri', 'text');
  instrumentField(nodes.image, 'embed_placeholder', 'media');
  instrumentField(nodes.title, 'title', 'text');
}

/**
 * Decorates the embed block.
 *
 * DOM de entrada (matriz EDS, contrato §3b) — 2 rows, one cell each:
 *   div.embed
 *     ├── div > div   embed group: <p><a href>URL</a></p> (embed_uri) + <picture><img alt>
 *     │                (embed_placeholder, alt = embed_placeholderAlt), in field order
 *     └── div > div   title: <p>text</p> (optional)
 *   embed_uri may also arrive as plain text; any field may be empty or missing.
 *
 * DOM de salida (contrato §3d):
 *   div.embed
 *     ├── div.embed-media (row 1) > div
 *     │     ├── p[hidden]                          the URL (kept for the editor)
 *     │     └── button.embed-placeholder[aria-haspopup=dialog][aria-label="Play video: …"]
 *     │           ├── picture                      the thumbnail, lazy
 *     │           └── svg.embed-play
 *     ├── div.embed-title (row 2) > div > p        over the thumbnail, not clickable
 *     └── dialog.embed-modal[aria-label]
 *           ├── button.embed-modal-close[aria-label]
 *           └── div.embed-modal-frame              iframe only while the modal is open
 *
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  const [mediaRow, titleRow] = [...block.children];
  const cell = mediaRow?.firstElementChild || mediaRow;

  const { source, holder } = readVideoUrl(cell);
  const id = getYouTubeId(source)
    || getYouTubeId(cell?.querySelector('img')?.getAttribute('src'));
  if (holder) holder.hidden = true;

  const picture = cell?.querySelector('picture');
  const img = picture?.querySelector('img');
  if (img) {
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    // The button is named by its aria-label; the author alt stays for the editor.
    if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
  }

  mediaRow?.classList.add('embed-media');

  const title = titleRow?.textContent.trim() || '';
  if (titleRow) {
    if (title) titleRow.classList.add('embed-title');
    else titleRow.hidden = true;
  }

  // Before the early return: a block without a valid URL must stay editable.
  instrumentBlock(block, {
    uri: holder,
    image: img,
    title: title ? titleRow.querySelector('p') || titleRow.firstElementChild : null,
  });

  if (!id || !cell) return;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'embed-placeholder';
  trigger.setAttribute('aria-haspopup', 'dialog');
  if (picture) {
    // xwalk may wrap the picture in a <p>: the empty wrapper goes once the picture moves.
    const wrapper = picture.parentElement;
    trigger.append(picture);
    if (wrapper !== cell && !wrapper.textContent.trim() && !wrapper.children.length) {
      wrapper.remove();
    }
  }
  trigger.append(buildPlayIcon());
  cell.append(trigger);

  let labels = { ...DEFAULT_LABELS };
  const dialog = buildModal(id, trigger, () => ({ title, labels }));
  block.append(dialog);
  applyLabels(trigger, dialog, title, labels);

  schedulePlaceholders(block, (siteLabels) => {
    labels = siteLabels;
    applyLabels(trigger, dialog, title, labels);
  });
}
