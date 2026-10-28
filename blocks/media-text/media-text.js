/**
 * Media Text Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-009 (.eds-pipeline/contracts/media-text.md)
 * Base: Adobe Block Collection (columns) @ commit 5ad878ba — only the two-column split and
 *   the stacking on mobile; the field model and the video are new (contract §1).
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - Placeholders: keys are kept as written and in camelCase. toCamelCase('pauseVideo') is
 *   'pausevideo', so the site texts (pauseVideo, playVideo, video) never reached the block and
 *   the hard-coded fallbacks were always shown.
 * - Universal Editor fallback instrumentation (instrumentBlock): only when AEM has not
 *   instrumented the block, never over the attributes AEM delivers. Blocks decorated inside a
 *   fragment (detached from the document) get a resource of their own, not the first block's.
 */

import { decorateIcons, toCamelCase } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/** Rule DH-10: watch, youtu.be, embed or thumbnail (img.youtube.com/vi/<id>/…) URLs. */
const YOUTUBE_ID_PATTERN = /(?:vi\/|embed\/|v=|youtu\.be\/)([\w-]{11})/;

// [EDS-COMP-009] The card fields are mediaHeading and mediaDescription (contract: media + Title
// and media + Text). Those names ended in the xwalk field-collapse suffixes Title and Text and
// AEM would render them as attributes of a missing "media" field. Renamed by decision of the
// person on 2026-10-28; the contract and the ticket mapping are updated at the Gate 2
// re-approval.
/** One row per field, in model order (contract §3b). classes is a block option, not a row. */
const FIELD_ORDER = ['title', 'text', 'image', 'video', 'mediaHeading', 'mediaDescription', 'link'];

/** YouTube host used for the embed and as the postMessage target origin. */
const VIDEO_ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * Player parameters observed on the portal (muted, no controls, inline), plus enablejsapi
 * so the pause control can command the player. autoplay is added per user preference.
 */
const VIDEO_PARAMS = 'mute=1&controls=0&playsinline=1&rel=0&iv_load_policy=3&modestbranding=1&enablejsapi=1';

/** Extra wait after window load, as in the hero, so the embed never delays the page. */
const VIDEO_DELAY_MS = 3000;

/** The player is requested only when the video gets this close to the viewport. */
const VIDEO_ROOT_MARGIN = '200px 0px';

/**
 * Fallback labels, used only when the site placeholders do not define the keys.
 * The site text lives in /placeholders.json (keys pauseVideo, playVideo and video).
 */
const DEFAULT_LABELS = {
  pauseVideo: 'Pause background video',
  playVideo: 'Play background video',
  video: 'Video',
};

/** Universal Editor labels of the fallback instrumentation (fields of _media-text.json). */
const UE_LABELS = {
  block: 'Texto con medio',
  title: 'Título',
  text: 'Texto',
  image: 'Imagen',
  video: 'Vídeo (URL de YouTube)',
  mediaHeading: 'Título de la tarjeta',
  mediaDescription: 'Subtítulo de la tarjeta',
  link: 'Enlace de la tarjeta',
};

let placeholdersRequest;

/** Blocks instrumented by the fallback while detached from the document (fragments). */
let detachedCount = 0;

/**
 * Fetches the site placeholders once (/placeholders.json, rows Key/Text). Keys are available
 * as written and in camelCase. Any failure resolves to an empty object.
 * @returns {Promise<Object<string, string>>} placeholders
 */
function fetchPlaceholders() {
  if (!placeholdersRequest) {
    placeholdersRequest = fetch('/placeholders.json')
      .then((response) => (response.ok ? response.json() : {}))
      // [QA] [ANTES] only toCamelCase(Key): 'pauseVideo' became 'pausevideo' and never matched.
      // [DESPUÉS] the key as written and its camelCase form, as in the form block.
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
 * @param {Element} row block row
 * @returns {boolean} true when the author left the field empty
 */
function isEmptyRow(row) {
  return !row.textContent.trim() && !row.querySelector('picture, img');
}

/**
 * @param {Element} row block row
 * @returns {string} the URL in the row, from a link or from plain text
 */
function getRowUrl(row) {
  const link = row.querySelector('a[href]');
  return link ? link.href : row.textContent.trim();
}

/**
 * @param {Element} row block row
 * @returns {boolean} true when the row holds a YouTube URL and nothing else
 */
function isVideoRow(row) {
  return !/\s/.test(row.textContent.trim()) && Boolean(getYouTubeId(getRowUrl(row)));
}

/**
 * @param {Element} row block row
 * @returns {boolean} true when the row holds one link and nothing else
 */
function isLinkRow(row) {
  const links = row.querySelectorAll('a[href]');
  return links.length === 1
    && !row.querySelector('h1, h2, h3, h4, h5, h6, picture')
    && row.textContent.trim() === links[0].textContent.trim();
}

/**
 * @param {Element} row block row
 * @returns {boolean} true when the row is a single paragraph of plain text
 */
function isPlainTextRow(row) {
  const cell = row.firstElementChild || row;
  const elements = [...cell.children];
  if (!elements.length) return true;
  return elements.length === 1 && elements[0].tagName === 'P' && !elements[0].children.length;
}

/**
 * Maps the block rows to the contract fields. The full model delivers one row per field,
 * so rows are read by position. Fewer rows (content authored by hand, a partial copy) are
 * classified by their content: picture, YouTube URL, lone link, and the rest as text,
 * where a leading plain paragraph followed by more text is the title.
 * @param {Element[]} rows block rows
 * @returns {Object<string, ?Element>} one row (or null) per field of FIELD_ORDER, plus
 *   moreText (further text rows, only when the rows were classified by content)
 */
function mapRows(rows) {
  const fields = Object.fromEntries(FIELD_ORDER.map((name) => [name, null]));

  if (rows.length === FIELD_ORDER.length) {
    rows.forEach((row, index) => {
      if (!isEmptyRow(row)) fields[FIELD_ORDER[index]] = row;
    });
    return fields;
  }

  const textRows = [];
  rows.filter((row) => !isEmptyRow(row)).forEach((row) => {
    if (!fields.image && row.querySelector('picture, img')) fields.image = row;
    else if (!fields.video && isVideoRow(row)) fields.video = row;
    else if (!fields.link && isLinkRow(row)) fields.link = row;
    else textRows.push(row);
  });
  if (textRows.length > 1 && isPlainTextRow(textRows[0])) fields.title = textRows.shift();
  fields.text = textRows.shift() || null;
  fields.moreText = textRows;
  return fields;
}

/**
 * Turns the plain-text row into a heading. The authored text nodes move into the heading
 * and the Universal Editor attributes of the paragraph follow them.
 * @param {Element} row title row
 * @param {string} level heading tag
 * @returns {Element} the heading
 */
function decorateHeading(row, level) {
  const cell = row.firstElementChild || row;
  const existing = cell.querySelector('h1, h2, h3, h4, h5, h6');
  if (existing) return existing;

  const heading = document.createElement(level);
  const paragraph = cell.querySelector('p');
  if (paragraph) {
    paragraph.before(heading);
    heading.append(...paragraph.childNodes);
    moveInstrumentation(paragraph, heading);
    paragraph.remove();
  } else {
    heading.append(...cell.childNodes);
    cell.append(heading);
  }
  return heading;
}

/**
 * Sends a command to the YouTube player through its iframe API.
 * @param {HTMLIFrameElement} iframe the player
 * @param {string} command 'pauseVideo' or 'playVideo'
 */
function commandPlayer(iframe, command) {
  iframe.contentWindow?.postMessage(
    JSON.stringify({ event: 'command', func: command, args: [] }),
    VIDEO_ORIGIN,
  );
}

/**
 * Builds the pause/play control (WCAG 2.2.2). The accessible name always names the action
 * the button will perform.
 * @param {Element} frame media frame
 * @param {HTMLIFrameElement} iframe the player
 * @param {Object<string, string>} labels pauseVideo and playVideo texts
 * @param {boolean} paused initial state (true when the player does not autoplay)
 */
function buildVideoToggle(frame, iframe, labels, paused) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'media-text-video-toggle';
  button.classList.toggle('media-text-video-paused', paused);
  button.setAttribute('aria-label', paused ? labels.playVideo : labels.pauseVideo);
  ['pause', 'play'].forEach((name) => {
    const icon = document.createElement('span');
    icon.className = `icon icon-${name}`;
    button.append(icon);
  });
  decorateIcons(button);

  button.addEventListener('click', () => {
    const isPaused = button.classList.toggle('media-text-video-paused');
    commandPlayer(iframe, isPaused ? 'pauseVideo' : 'playVideo');
    button.setAttribute('aria-label', isPaused ? labels.playVideo : labels.pauseVideo);
  });

  frame.append(button);
}

/**
 * Builds the player inside the frame. It stays transparent until it loads, so the frame
 * (and the image, when the author set one) acts as the poster. Like the portal, it plays
 * muted on its own; with prefers-reduced-motion it waits for the play control instead.
 * @param {Element} frame media frame
 * @param {string} id YouTube id
 * @param {string} title text of the block title, if any
 */
async function buildVideo(frame, id, title) {
  const placeholders = await fetchPlaceholders();
  const labels = Object.fromEntries(Object.entries(DEFAULT_LABELS)
    .map(([key, value]) => [key, placeholders[key] || value]));
  const autoplay = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The portal player has no controls, so nothing inside it is operable: it stays out of
  // the focus order and the accessibility tree (inert), and the toggle is its only control.
  const player = document.createElement('div');
  player.className = 'media-text-player';
  player.inert = true;

  const iframe = document.createElement('iframe');
  iframe.src = `${VIDEO_ORIGIN}/embed/${id}?autoplay=${autoplay ? 1 : 0}&${VIDEO_PARAMS}`;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.title = title ? `${labels.video}: ${title}` : labels.video;
  iframe.addEventListener('load', () => {
    player.classList.add('media-text-player-loaded');
    buildVideoToggle(frame, iframe, labels, !autoplay);
  }, { once: true });

  player.append(iframe);
  frame.append(player);
}

/**
 * Requests the player only after window load plus a delay (it never competes with the
 * LCP, same rule as the hero) and when the frame approaches the viewport. The frame
 * reserves its size, so nothing shifts when the player arrives.
 * @param {Element} frame media frame
 * @param {string} id YouTube id
 * @param {string} title text of the block title, if any
 */
function scheduleVideo(frame, id, title) {
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    buildVideo(frame, id, title);
  }, { rootMargin: VIDEO_ROOT_MARGIN });
  const start = () => window.setTimeout(() => observer.observe(frame), VIDEO_DELAY_MS);
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/**
 * Builds the media column: the frame (image and/or video) and, when the author filled
 * them, the card body (mediaHeading, mediaDescription and link).
 * @param {Object<string, ?Element>} fields rows per field
 * @param {string} title text of the block title, if any
 * @returns {?Element} the media column, or null when it would be empty
 */
function buildMedia(fields, title) {
  const media = document.createElement('div');
  media.className = 'media-text-media';

  const videoId = fields.video ? getYouTubeId(getRowUrl(fields.video)) : null;
  if (fields.video) fields.video.hidden = true;

  let frame = fields.image;
  if (frame) {
    frame.querySelectorAll('img').forEach((img) => {
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
    });
  } else if (videoId) {
    frame = document.createElement('div');
  }
  if (frame) {
    frame.classList.add('media-text-frame');
    if (videoId) {
      frame.classList.add('media-text-frame-video');
      scheduleVideo(frame, videoId, title);
    }
    media.append(frame);
  }

  if (fields.mediaHeading || fields.mediaDescription || fields.link) {
    const body = document.createElement('div');
    body.className = 'media-text-body';
    if (fields.mediaHeading) {
      fields.mediaHeading.classList.add('media-text-media-title');
      decorateHeading(fields.mediaHeading, 'h3');
      body.append(fields.mediaHeading);
    }
    if (fields.mediaDescription) {
      fields.mediaDescription.classList.add('media-text-media-text');
      body.append(fields.mediaDescription);
    }
    if (fields.link) {
      fields.link.classList.add('media-text-link');
      // A link the author did not format as a button is the solid CTA of the card.
      fields.link.querySelectorAll('a[href]:not(.button)').forEach((link) => {
        link.classList.add('button', 'primary');
      });
      body.append(fields.link);
    }
    media.append(body);
  }

  return media.children.length ? media : null;
}

/**
 * Marks one editable field for Universal Editor, unless AEM already did.
 * @param {?Element} element node that shows the field
 * @param {string} prop field name in models[] of _media-text.json
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
 * already instrumented with the real resource of the component: those attributes travel with
 * the rows decorate() moves (moveInstrumentation keeps the ones of the paragraphs that become
 * headings), and are never overwritten. Only a block AEM has not instrumented (local drafts,
 * preview) gets this fallback, with a resource built from the current path and the position
 * of the block in the page.
 * imageAlt and linkText collapse into the alt of the image and the text of the link, so they
 * share the node of their pair; classes is a block option. Empty fields stay hidden in their
 * rows and are edited from the properties panel.
 * @param {Element} block the block
 * @param {Object<string, ?Element>} fields rows per field (mapRows)
 */
function instrumentBlock(block, fields) {
  if (block.dataset.aueResource) return;
  // One resource per block: Universal Editor looks blocks up by data-aue-resource.
  // [QA] [ANTES] Math.max(0, indexOf(block)): a fragment is decorated before it is attached to
  // the document, indexOf is -1 and every block of the fragment took "#media-text-0", the
  // resource of the first block of the page. [DESPUÉS] detached blocks get their own suffix.
  const position = [...document.querySelectorAll('.media-text')].indexOf(block);
  const suffix = position >= 0 ? position : `detached-${detachedCount += 1}`;
  block.dataset.aueResource = `urn:aemconnection:${window.location.pathname}#media-text-${suffix}`;
  block.dataset.aueType = 'component';
  block.dataset.aueModel = 'media-text';
  block.dataset.aueLabel = UE_LABELS.block;

  const heading = (row) => row?.querySelector('h1, h2, h3, h4, h5, h6');
  instrumentField(heading(fields.title), 'title', 'text');
  instrumentField(fields.text?.firstElementChild, 'text', 'richtext');
  instrumentField(fields.image?.querySelector('img'), 'image', 'media');
  instrumentField(fields.video?.firstElementChild, 'video', 'text');
  instrumentField(heading(fields.mediaHeading), 'mediaHeading', 'text');
  instrumentField(fields.mediaDescription?.firstElementChild, 'mediaDescription', 'richtext');
  instrumentField(fields.link?.querySelector('a[href]'), 'link', 'aem-content');
}

/**
 * Decorates the media-text block.
 *
 * DOM de entrada (matriz EDS, contrato §3b) — one row per field, one cell per row:
 *   div.media-text[.media-left|.media-right|.card]   ← classes (block option, not a row)
 *     ├── div > div > p                title (plain text, optional)
 *     ├── div > div > p | ul | h*      text (richtext, required)
 *     ├── div > div > picture > img    image (alt = imageAlt, optional)
 *     ├── div > div > p                video (YouTube URL, rule DH-10, optional)
 *     ├── div > div > p                mediaHeading (plain text, optional)
 *     ├── div > div > p | ul | h*      mediaDescription (richtext, optional)
 *     └── div > div > p > a            link + linkText (optional)
 *   Empty fields arrive as empty rows and stay in the block, hidden.
 *
 * DOM de salida (contrato §3d):
 *   div.media-text
 *     ├── div.media-text-content       (after the media in media-left)
 *     │     ├── title row > div > h2
 *     │     └── div.media-text-text    text row
 *     └── div.media-text-media
 *           ├── div.media-text-frame   image row, or a new div for a video without image
 *           │     ├── div.media-text-player > iframe   (deferred, see scheduleVideo)
 *           │     └── button.media-text-video-toggle   (once the player has loaded)
 *           └── div.media-text-body    mediaHeading (h3), mediaDescription and link rows
 *
 * The side of the media is not in the DOM (contract §10): media-left puts it first,
 * media-right and card (and no option) put it after the text.
 *
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  const rows = [...block.children];
  const fields = mapRows(rows);

  rows.filter(isEmptyRow).forEach((row) => { row.hidden = true; });

  const content = document.createElement('div');
  content.className = 'media-text-content';

  let title = '';
  if (fields.title) {
    fields.title.classList.add('media-text-title');
    title = decorateHeading(fields.title, 'h2').textContent.trim();
    content.append(fields.title);
  }
  [fields.text, ...(fields.moreText || [])].filter(Boolean).forEach((row) => {
    row.classList.add('media-text-text');
    content.append(row);
  });

  const media = buildMedia(fields, title);
  const parts = [content.children.length && content, media].filter(Boolean);
  if (block.classList.contains('media-left')) parts.reverse();
  block.prepend(...parts);

  instrumentBlock(block, fields);
}
