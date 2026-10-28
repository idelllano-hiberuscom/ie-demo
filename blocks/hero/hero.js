/**
 * Hero Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-005 (.eds-pipeline/contracts/hero.md)
 * Base: Adobe Block Collection (hero) @ commit 5ad878ba, extended with optional fields
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - Title: the authored <p> is no longer nested inside the heading (invalid HTML);
 *   its text and its data-aue-* attributes move to the heading.
 * - One-h1 check ignores the copy of this same block that Universal Editor keeps in
 *   the page while it re-decorates the updated one (it demoted the title to h2).
 * - Universal Editor fallback instrumentation (instrumentBlock): only when AEM has not
 *   instrumented the block, never over the attributes AEM delivers.
 */

// Note [EDS-COMP-005]: CTA hover and active states are not extracted (contract §7) and are
// not invented (orchestrator decision); focus is the global ring of styles.css (EDS-FIX-002).

import { decorateIcons, toCamelCase } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/** Rule DH-10: watch, youtu.be, embed or thumbnail (img.youtube.com/vi/<id>/…) URLs. */
const YOUTUBE_ID_PATTERN = /(?:vi\/|embed\/|v=|youtu\.be\/)([\w-]{11})/;

/** One row per field, in model order (contract §3b). */
const FIELD_ORDER = ['image', 'video', 'title', 'text', 'link', 'link2'];

/** Extra wait after window load so the embed never competes with the LCP image. */
const VIDEO_DELAY_MS = 3000;

/** YouTube host used for the embed and as the postMessage target origin. */
const VIDEO_ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * Player parameters observed on the portal (autoplay, muted, no controls), plus
 * enablejsapi so the pause control can command the player.
 */
const VIDEO_PARAMS = 'autoplay=1&mute=1&controls=0&playsinline=1&rel=0&iv_load_policy=3&modestbranding=1&enablejsapi=1';

/**
 * Fallback labels, used only when the site placeholders do not define the keys.
 * The site text lives in /placeholders.json (keys pauseVideo and playVideo).
 */
const DEFAULT_LABELS = {
  pauseVideo: 'Pause background video',
  playVideo: 'Play background video',
};

let placeholdersRequest;

/**
 * Fetches the site placeholders once (/placeholders.json, rows Key/Text) and
 * returns them keyed both as written and in camelCase: toCamelCase lowercases
 * camelCase keys (pauseVideo -> pausevideo), so the raw key must stay readable.
 * Any failure resolves to an empty object.
 * @returns {Promise<Object<string, string>>} placeholders
 */
function fetchPlaceholders() {
  if (!placeholdersRequest) {
    placeholdersRequest = fetch('/placeholders.json')
      .then((response) => (response.ok ? response.json() : {}))
      .then((json) => Object.fromEntries((json.data || [])
        .filter((row) => row.Key && row.Text)
        .flatMap((row) => [[toCamelCase(row.Key), row.Text], [row.Key, row.Text]])))
      .catch(() => ({}));
  }
  return placeholdersRequest;
}

/**
 * Extracts the YouTube id from any accepted URL form.
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
 * @returns {boolean} true when the row holds a YouTube URL and nothing else
 */
function isVideoRow(row) {
  const value = row.textContent.trim();
  return !/\s/.test(value) && Boolean(getYouTubeId(getRowUrl(row)));
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
 * Maps the block rows to the contract fields. The full model delivers one row per
 * field, so rows are read by position. A hero authored before this version
 * (image + text) delivers fewer rows, which are classified by their content.
 * @param {Element[]} rows block rows
 * @returns {{image: ?Element, video: ?Element, title: ?Element,
 *   text: Element[], links: Element[], linkProps: string[]}} rows per field
 *   (linkProps holds the model field of each link row: 'link' or 'link2')
 */
function mapRows(rows) {
  const fields = {
    image: null, video: null, title: null, text: [], links: [], linkProps: [],
  };

  if (rows.length === FIELD_ORDER.length) {
    rows.forEach((row, index) => {
      if (isEmptyRow(row)) return;
      const name = FIELD_ORDER[index];
      if (name === 'link' || name === 'link2') {
        fields.links.push(row);
        fields.linkProps.push(name);
      } else if (name === 'text') fields.text.push(row);
      else fields[name] = row;
    });
    return fields;
  }

  const textRows = [];
  rows.forEach((row) => {
    if (isEmptyRow(row)) return;
    if (!fields.image && row.querySelector('picture, img')) fields.image = row;
    else if (!fields.video && isVideoRow(row)) fields.video = row;
    else if (fields.links.length < 2 && isLinkRow(row)) {
      fields.linkProps.push(fields.links.length ? 'link2' : 'link');
      fields.links.push(row);
    } else textRows.push(row);
  });
  if (textRows.length > 1 && isPlainTextRow(textRows[0])) fields.title = textRows.shift();
  fields.text = textRows;
  return fields;
}

/**
 * Turns the plain-text title into a heading, keeping the authored node inside it.
 * @param {Element} row title row
 * @param {string} level 'h1' or 'h2'
 * @returns {Element} the heading
 */
function decorateTitle(row, level) {
  const cell = row.firstElementChild || row;
  const existing = cell.querySelector('h1, h2, h3, h4, h5, h6');
  if (existing) return existing;

  const heading = document.createElement(level);
  const paragraph = cell.querySelector('p');
  if (paragraph) {
    // [QA] [ANTES] heading.append(paragraph) → <h1><p>…</p></h1>, a <p> inside a heading
    // is invalid HTML. [DESPUÉS] the authored text nodes move into the heading, the
    // Universal Editor attributes follow them (moveInstrumentation) and the empty <p> goes.
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
 * The hero of the first section is the LCP candidate: eager and high priority.
 * Any other hero (the banner is a band further down) loads lazily.
 * @param {Element} block the block
 * @param {HTMLImageElement} img the background image
 */
function setImagePriority(block, img) {
  const section = block.closest('main > .section');
  const isLcp = Boolean(section) && section === document.querySelector('main > .section')
    && block === section.querySelector('.hero');
  if (isLcp) {
    img.setAttribute('loading', 'eager');
    img.setAttribute('fetchpriority', 'high');
  } else {
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  }
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
 * Builds the pause/play control (WCAG 2.2.2). The accessible name changes with
 * the state: it always names the action the button will perform.
 * @param {Element} block the block
 * @param {HTMLIFrameElement} iframe the player
 * @param {Object<string, string>} labels pauseVideo and playVideo texts
 */
function buildVideoToggle(block, iframe, labels) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hero-video-toggle';
  button.setAttribute('aria-label', labels.pauseVideo);
  ['pause', 'play'].forEach((name) => {
    const icon = document.createElement('span');
    icon.className = `icon icon-${name}`;
    button.append(icon);
  });
  decorateIcons(button);

  button.addEventListener('click', () => {
    const paused = button.classList.toggle('hero-video-paused');
    commandPlayer(iframe, paused ? 'pauseVideo' : 'playVideo');
    button.setAttribute('aria-label', paused ? labels.playVideo : labels.pauseVideo);
  });

  block.append(button);
}

/**
 * Builds the background player. It stays transparent until it loads, so the
 * image underneath acts as the poster; the pause control appears with it.
 * @param {Element} block the block
 * @param {Element} media media container
 * @param {string} id YouTube id
 * @param {string} label accessible title taken from the authored heading
 */
async function buildVideo(block, media, id, label) {
  const placeholders = await fetchPlaceholders();
  const labels = {
    pauseVideo: placeholders.pauseVideo || DEFAULT_LABELS.pauseVideo,
    playVideo: placeholders.playVideo || DEFAULT_LABELS.playVideo,
  };

  const wrapper = document.createElement('div');
  wrapper.className = 'hero-video';

  const iframe = document.createElement('iframe');
  iframe.src = `${VIDEO_ORIGIN}/embed/${id}?${VIDEO_PARAMS}`;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute('aria-hidden', 'true');
  if (label) iframe.title = label;
  iframe.addEventListener('load', () => {
    wrapper.classList.add('hero-video-loaded');
    buildVideoToggle(block, iframe, labels);
  }, { once: true });

  wrapper.append(iframe);
  media.append(wrapper);
}

/**
 * Defers the player until after window load plus a delay, and skips it entirely
 * when the user prefers reduced motion (the image stays as a still background,
 * with no player and no control).
 * @param {Element} block the block
 * @param {Element} media media container
 * @param {string} id YouTube id
 * @param {string} label accessible title
 */
function scheduleVideo(block, media, id, label) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = () => window.setTimeout(() => buildVideo(block, media, id, label), VIDEO_DELAY_MS);
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/** Universal Editor labels: the same labels as models[] in _hero.json. */
const UE_LABELS = {
  block: 'Hero',
  image: 'Imagen de fondo',
  video: 'Vídeo de fondo (URL de YouTube)',
  title: 'Título',
  text: 'Texto',
  link: 'Enlace principal',
  link2: 'Enlace secundario',
};

/**
 * True when the page already has an h1 outside this hero. While Universal Editor
 * re-decorates an updated block, the previous copy (same data-aue-resource) is
 * still in the page: its h1 does not count.
 * @param {Element} block the block
 * @returns {boolean} whether the hero title must be demoted to h2
 */
function hasPageH1(block) {
  const { aueResource } = block.dataset;
  return [...document.querySelectorAll('main h1')]
    .some((h1) => !aueResource || h1.closest('.block')?.dataset.aueResource !== aueResource);
}

/**
 * Marks one editable field for Universal Editor, unless AEM already did.
 * @param {?Element} element node that shows the field
 * @param {string} prop field name in models[] of _hero.json
 * @param {string} type data-aue-type
 */
function instrumentField(element, prop, type) {
  if (!element || element.dataset.aueProp) return;
  element.dataset.aueProp = prop;
  element.dataset.aueType = type;
  element.dataset.aueLabel = UE_LABELS[prop];
}

/**
 * Universal Editor instrumentation (xwalk). On the author instance AEM delivers the
 * block already instrumented with the real resource of the component: those
 * attributes travel with the rows decorate() moves (and moveInstrumentation keeps the
 * title's), and are never overwritten. Only a block AEM has not instrumented (local
 * drafts, preview) gets this fallback, with a resource built from the current path
 * and the position of the hero in the page.
 * imageAlt, linkText and link2Text collapse into the alt of the image and the text of
 * each link, so they share the node of their pair; classes is a block option.
 * @param {Element} block the block
 * @param {Object} fields rows per field (mapRows)
 * @param {?Element} heading decorated title
 */
function instrumentBlock(block, fields, heading) {
  if (block.dataset.aueResource) return;
  // One resource per hero: Universal Editor looks blocks up by data-aue-resource.
  const position = Math.max(0, [...document.querySelectorAll('.hero')].indexOf(block));
  block.dataset.aueResource = `urn:aemconnection:${window.location.pathname}#hero-${position}`;
  block.dataset.aueType = 'component';
  block.dataset.aueModel = 'hero';
  block.dataset.aueLabel = UE_LABELS.block;

  instrumentField(fields.image?.querySelector('img'), 'image', 'media');
  instrumentField(fields.video?.firstElementChild, 'video', 'text');
  instrumentField(heading, 'title', 'text');
  instrumentField(fields.text[0]?.firstElementChild, 'text', 'richtext');
  fields.links.forEach((row, index) => {
    instrumentField(row.querySelector('a[href]'), fields.linkProps[index], 'aem-content');
  });
}

/**
 * Decorates the hero block.
 *
 * DOM de entrada (matriz EDS, contrato §3b) — one row per field, one cell per row:
 *   div.hero[.video|.banner]           ← classes (block option, not a row)
 *     ├── div > div > picture > img    image (alt = imageAlt)
 *     ├── div > div > p                video (YouTube URL, rule DH-10)
 *     ├── div > div > p                title (plain text, optional)
 *     ├── div > div > p | ul | h*      text (richtext)
 *     ├── div > div > p > a            link + linkText
 *     └── div > div > p > a            link2 + link2Text
 *   Every field is optional; empty fields arrive as empty rows. A hero authored
 *   before this version arrives with fewer rows (image, text).
 *
 * DOM de salida (contrato §3d):
 *   div.hero
 *     ├── div.hero-media               image row (+ div.hero-video once deferred)
 *     └── div.hero-content
 *           ├── title row > div > h1|h2 (h2 in the banner variant, or when the page
 *           │                            already has an h1; div.hero-title outside the banner)
 *           ├── div.hero-text          text row
 *           └── div.hero-actions       link rows, anchors as a.button
 *     └── button.hero-video-toggle     only once the deferred video has loaded
 *
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  const rows = [...block.children];
  const fields = mapRows(rows);

  rows.filter(isEmptyRow).forEach((row) => { row.hidden = true; });

  let media = fields.image;
  if (media) {
    media.classList.add('hero-media');
    const img = media.querySelector('img');
    if (img) setImagePriority(block, img);
  }

  const content = document.createElement('div');
  content.className = 'hero-content';

  // One h1 per page (contract §8): the banner is always h2, and a hero that comes
  // after an existing h1 is demoted to h2 while keeping the hero title size.
  let heading = null;
  if (fields.title) {
    const isBanner = block.classList.contains('banner');
    const level = isBanner || hasPageH1(block) ? 'h2' : 'h1';
    if (!isBanner) fields.title.classList.add('hero-title');
    heading = decorateTitle(fields.title, level);
    content.append(fields.title);
  }

  fields.text.forEach((row) => {
    row.classList.add('hero-text');
    content.append(row);
  });

  if (fields.links.length) {
    const actions = document.createElement('div');
    actions.className = 'hero-actions';
    fields.links.forEach((row) => {
      row.querySelectorAll('a[href]').forEach((link) => link.classList.add('button'));
      actions.append(row);
    });
    content.append(actions);
  }

  if (content.children.length) block.append(content);

  instrumentBlock(block, fields, heading);

  if (fields.video) {
    fields.video.hidden = true;
    const id = getYouTubeId(getRowUrl(fields.video));
    if (id) {
      if (!media) {
        media = document.createElement('div');
        media.className = 'hero-media';
        block.prepend(media);
      }
      const label = (heading || block.querySelector('h1, h2'))?.textContent.trim() || '';
      scheduleVideo(block, media, id, label);
    }
  }
}
