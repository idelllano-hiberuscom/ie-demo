/**
 * Accordion Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-013 (.eds-pipeline/contracts/accordion.md)
 * Base: Adobe Block Collection (accordion) @ commit 5ad878ba, extended (DH-06, DH-10)
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - The document cell is decorated in place and stays the last child of the item, after the
 *   body: omitting the last field (document) no longer takes the panel with it. The toggle
 *   controls both panels (body and document) through aria-controls.
 * - decorate() is idempotent: an item that is already decorated is left as it is, and the
 *   click handler is wired once per block (a second decoration used to toggle twice).
 * - Panels are resolved inside the item, not by document.getElementById (ids are not
 *   unique when the block is cloned or re-rendered by Universal Editor).
 * - Instrumentation of the cells that are dropped after moving their content (icon, images)
 *   moves to the element that receives it, so Universal Editor keeps it.
 * - Universal Editor: selecting an item, or a field inside a closed item, opens it
 *   (aue:ui-select). Fallback data-aue-* only when AEM has not instrumented the block.
 * - Items are independent (orchestrator decision, 1:1 with the portal): closes the TODO.
 */
import { moveInstrumentation } from '../../scripts/scripts.js';

// i18n: fixed labels painted by the block (DH-06). Single place to translate them.
const LABELS = {
  team: 'Team Members',
  discoverMore: 'Discover More',
  video: 'Video',
};

// DH-10: watch, youtu.be, embed or thumbnail (img.youtube.com/vi/<id>/…) URLs.
const YOUTUBE_ID = /(?:vi\/|embed\/|v=|youtu\.be\/)([\w-]{11})/;

// Cell order of each item, as xwalk renders the accordion-item model (contract §3b).
// iconAlt, imageNAlt and documentTitle collapse into attributes of their pair (field collapse):
// documentTitle arrives as the title attribute of the document link. Index 10 is only a
// tolerance for content that delivers documentTitle as a cell of its own.
const CELL = {
  icon: 0,
  summary: 1,
  text: 2,
  images: [3, 4, 5, 6],
  video: 7,
  team: 8,
  document: 9,
  documentTitle: 10,
};

// Fields of the accordion-item model that own an element in the DOM (contract §5).
// The *Alt fields and documentTitle collapse into the img alt and the link title.
const UE_FIELDS = {
  icon: { type: 'media', label: 'Icono' },
  summary: { type: 'text', label: 'Título del proyecto' },
  text: { type: 'richtext', label: 'Texto' },
  image: { type: 'media', label: 'Foto' },
  video: { type: 'text', label: 'Vídeo (URL de YouTube)' },
  team: { type: 'richtext', label: 'Equipo' },
  document: { type: 'media', label: 'Documento PDF' },
};

let idCounter = 0;

/** Blocks instrumented by the fallback while detached from the document (fragments). */
let detachedCount = 0;

// Blocks whose click handler is already wired (decorate() may run twice on the same block).
const wiredBlocks = new WeakSet();

/**
 * Tells whether a cell carries authored content.
 * @param {Element} [cell]
 * @returns {boolean}
 */
function hasContent(cell) {
  return Boolean(cell && (cell.textContent.trim() || cell.querySelector('picture, img, a')));
}

/**
 * Applies the loading policy of contract §6: nothing in the accordion is LCP.
 * Keeps the author alt; an image without alt is marked decorative.
 * @param {HTMLImageElement} img
 */
function prepareImage(img) {
  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
}

/**
 * Builds the toggle bar: <h3><button>icon + summary + chevron</button></h3>.
 * @param {Element} iconCell
 * @param {Element} summaryCell
 * @param {string} bodyId
 * @returns {{ label: HTMLHeadingElement, button: HTMLButtonElement }}
 */
function buildLabel(iconCell, summaryCell, bodyId) {
  const label = document.createElement('h3');
  label.className = 'accordion-item-label';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'accordion-item-toggle';
  button.id = `${bodyId}-toggle`;
  button.setAttribute('aria-expanded', 'false');

  const iconPicture = iconCell?.querySelector('picture');
  if (iconPicture) {
    const icon = document.createElement('span');
    icon.className = 'accordion-item-icon';
    moveInstrumentation(iconCell, icon);
    iconPicture.querySelectorAll('img').forEach(prepareImage);
    icon.append(iconPicture);
    button.append(icon);
  }

  const title = document.createElement('span');
  title.className = 'accordion-item-title';
  if (summaryCell) {
    const source = summaryCell.querySelector('p, h1, h2, h3, h4, h5, h6') || summaryCell;
    moveInstrumentation(summaryCell, title);
    if (source !== summaryCell) moveInstrumentation(source, title);
    title.append(...source.childNodes);
  }
  button.append(title);

  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('class', 'accordion-item-chevron');
  chevron.setAttribute('viewBox', '0 0 48 48');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M17 20.5l7 7 7-7');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  chevron.append(path);
  button.append(chevron);

  label.append(button);
  return { label, button };
}

/**
 * Moves the authored pictures (image1-image4) into a gallery list.
 * @param {Element[]} imageCells
 * @returns {HTMLUListElement|null}
 */
function buildGallery(imageCells) {
  const filled = imageCells
    .map((cell, index) => ({ cell, index, picture: cell?.querySelector('picture') }))
    .filter(({ picture }) => picture);
  if (!filled.length) return null;

  const gallery = document.createElement('ul');
  gallery.className = 'accordion-item-gallery';
  filled.forEach(({ cell, index, picture }) => {
    const li = document.createElement('li');
    li.dataset.field = `image${index + 1}`;
    moveInstrumentation(cell, li);
    picture.querySelectorAll('img').forEach(prepareImage);
    li.append(picture);
    gallery.append(li);
  });
  return gallery;
}

/**
 * Turns the video cell into a YouTube embed (DH-10). The iframe is lazy and lives in a
 * collapsed panel, so nothing is requested until the item is opened.
 * @param {Element} [videoCell]
 * @param {string} name accessible name of the item
 * @returns {HTMLDivElement|null}
 */
function buildVideo(videoCell, name) {
  if (!hasContent(videoCell)) return null;
  const link = videoCell.querySelector('a[href]');
  const source = link ? link.href : videoCell.textContent.trim();
  const match = source.match(YOUTUBE_ID);
  if (!match) return null;

  const video = document.createElement('div');
  video.className = 'accordion-item-video';
  moveInstrumentation(videoCell, video);

  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${match[1]}`;
  iframe.loading = 'lazy';
  iframe.title = name ? `${LABELS.video}: ${name}` : LABELS.video;
  iframe.allow = 'encrypted-media; picture-in-picture; fullscreen';
  video.append(iframe);
  return video;
}

/**
 * Tells whether a link text is the raw reference (a path or a URL) and not a human title.
 * @param {string} value
 * @returns {boolean}
 */
function isRawReference(value) {
  return /^(https?:)?\/|^\.{0,2}\/|\.pdf(\?|#|$)/i.test(value);
}

/**
 * Reads the documentTitle: the title attribute produced by field collapse, or its own cell
 * if the content delivers one. decorateButtons() copies the link text into an empty title,
 * so a title equal to the raw reference counts as missing.
 * @param {HTMLAnchorElement} link
 * @param {Element} [titleCell]
 * @returns {string}
 */
function readDocumentTitle(link, titleCell) {
  const fromCell = titleCell?.textContent.trim();
  if (fromCell) return fromCell;
  const title = (link.getAttribute('title') || '').trim();
  if (!title || title === link.getAttribute('href') || isRawReference(title)) return '';
  return title;
}

/**
 * Decorates the document reference (PDF in the DAM) as an accessible download link, in
 * place inside its own cell: visible text «Discover More», accessible name
 * «Discover More: <documentTitle> (PDF)». Accepts <p><a href>…</a></p> or a bare path/URL
 * written as text.
 * @param {Element} [documentCell]
 * @param {Element} [titleCell]
 * @returns {HTMLAnchorElement|null}
 */
function decorateDownload(documentCell, titleCell) {
  if (!hasContent(documentCell)) return null;

  let link = documentCell.querySelector('a[href]');
  if (!link) {
    const raw = documentCell.textContent.trim();
    if (!isRawReference(raw)) return null;
    const holder = documentCell.querySelector('p') || documentCell;
    link = document.createElement('a');
    link.href = raw;
    holder.textContent = '';
    holder.append(link);
  }

  const documentTitle = readDocumentTitle(link, titleCell);
  const href = link.getAttribute('href');
  let isPdf = false;
  try {
    isPdf = /\.pdf$/i.test(new URL(href, window.location.href).pathname);
  } catch {
    isPdf = /\.pdf(\?|#|$)/i.test(href);
  }

  link.classList.add('button', 'secondary', 'accordion-item-download');
  link.textContent = LABELS.discoverMore;
  if (documentTitle) link.title = documentTitle;
  else link.removeAttribute('title');
  if (isPdf) link.setAttribute('download', '');

  const context = [documentTitle && `: ${documentTitle}`, isPdf && ' (PDF)'].filter(Boolean).join('');
  if (context) {
    const hidden = document.createElement('span');
    hidden.className = 'accordion-item-download-context';
    hidden.textContent = context;
    link.append(hidden);
  }
  return link;
}

/**
 * Returns the panels an item toggles: the body and, when present, the document cell.
 * @param {Element} item
 * @returns {Element[]}
 */
function getPanels(item) {
  return [...item.querySelectorAll(':scope > .accordion-item-body, :scope > .accordion-item-document')];
}

/**
 * Opens or closes one item.
 * @param {HTMLButtonElement} button
 * @param {boolean} expanded
 */
function setExpanded(button, expanded) {
  const item = button.closest('.accordion-item');
  if (!item) return;
  button.setAttribute('aria-expanded', String(expanded));
  getPanels(item).forEach((panel) => { panel.hidden = !expanded; });
}

/**
 * Decorates one accordion item (one row of the block).
 *
 * Children of the decorated item, in field order: the bar (icon + summary), the body
 * (text, images, team, video) and the document cell, kept in place as the last child.
 * @param {Element} row
 */
function decorateItem(row) {
  // Already decorated (decorate() ran twice on the same content): leave it as it is.
  if (row.querySelector(':scope > .accordion-item-label')) return;

  const cells = [...row.children];
  const cell = (index) => cells[index];

  idCounter += 1;
  const bodyId = `accordion-item-${idCounter}`;
  row.classList.add('accordion-item');

  const { label, button } = buildLabel(cell(CELL.icon), cell(CELL.summary), bodyId);
  const name = button.querySelector('.accordion-item-title').textContent.trim();

  const body = document.createElement('div');
  body.className = 'accordion-item-body';
  body.id = bodyId;
  body.hidden = true;

  const text = cell(CELL.text);
  if (hasContent(text)) {
    text.className = 'accordion-item-text';
    body.append(text);
  }

  const gallery = buildGallery(CELL.images.map(cell));
  if (gallery) body.append(gallery);

  const team = cell(CELL.team);
  const video = buildVideo(cell(CELL.video), name);

  if (hasContent(team) || video) {
    const details = document.createElement('div');
    details.className = 'accordion-item-details';
    if (hasContent(team)) {
      const credits = document.createElement('div');
      credits.className = 'accordion-item-credits';
      const heading = document.createElement('h4');
      heading.className = 'accordion-item-team-title';
      heading.textContent = LABELS.team;
      team.className = 'accordion-item-team';
      credits.append(heading, team);
      details.append(credits);
    }
    if (video) details.append(video);
    body.append(details);
  }

  const documentCell = cell(CELL.document);
  const download = decorateDownload(documentCell, cell(CELL.documentTitle));
  const panels = [body];
  if (download) {
    documentCell.className = 'accordion-item-document';
    documentCell.id = `${bodyId}-document`;
    documentCell.hidden = true;
    panels.push(documentCell);
  }
  button.setAttribute('aria-controls', panels.map((panel) => panel.id).join(' '));

  // Cells whose content was moved into the bar or the body stay empty: drop them.
  cells.forEach((original) => {
    if (!panels.some((panel) => panel === original || panel.contains(original))) original.remove();
  });

  row.prepend(label, body);
}

/**
 * Fallback instrumentation for Universal Editor. AEM delivers the data-aue-* attributes of
 * the block, its items and their fields when the page is opened in the editor, and
 * moveInstrumentation() keeps them through the decoration: those always win. This only
 * runs when the block arrives without them, and never overwrites an attribute.
 * @param {Element} block
 * @param {number} blockIndex
 */
function instrumentFallback(block, blockIndex) {
  if (block.dataset.aueResource) return;
  const base = `urn:aemconnection:${window.location.pathname}#accordion-${blockIndex}`;

  const set = (element, values) => {
    if (!element) return;
    Object.entries(values).forEach(([key, value]) => {
      if (!element.dataset[key]) element.dataset[key] = value;
    });
  };
  const field = (element, name, spec, label = spec.label) => set(element, {
    aueProp: name, aueType: spec.type, aueLabel: label,
  });

  set(block, {
    aueResource: base,
    aueType: 'container',
    aueFilter: 'accordion',
    aueLabel: 'Acordeón',
    aueBehavior: 'component',
  });

  [...block.children].forEach((item, index) => {
    const title = item.querySelector('.accordion-item-title');
    set(item, {
      aueResource: `${base}/item-${index}`,
      aueType: 'component',
      aueModel: 'accordion-item',
      aueLabel: `Proyecto: ${title?.textContent.trim() || index + 1}`,
    });
    field(item.querySelector('.accordion-item-icon img'), 'icon', UE_FIELDS.icon);
    field(title, 'summary', UE_FIELDS.summary);
    field(item.querySelector('.accordion-item-text'), 'text', UE_FIELDS.text);
    item.querySelectorAll('.accordion-item-gallery li').forEach((li, position) => {
      const name = li.dataset.field || `image${position + 1}`;
      field(li.querySelector('img'), name, UE_FIELDS.image, `${UE_FIELDS.image.label} ${name.slice(-1)}`);
    });
    field(item.querySelector('.accordion-item-video'), 'video', UE_FIELDS.video);
    field(item.querySelector('.accordion-item-team'), 'team', UE_FIELDS.team);
    field(item.querySelector('.accordion-item-download'), 'document', UE_FIELDS.document);
  });
}

/**
 * Universal Editor: when the author selects an item, or a field inside a closed item
 * (content tree or properties rail), the item opens so the selection is visible.
 * @param {CustomEvent} event aue:ui-select, detail { resource, selected }
 */
function openOnEditorSelect(event) {
  const { resource, selected } = event.detail || {};
  if (!selected) return;
  const target = (resource && [...document.querySelectorAll('[data-aue-resource]')]
    .find((element) => element.dataset.aueResource === resource))
    || (event.target instanceof Element ? event.target : null);
  const item = target?.closest('.accordion .accordion-item');
  const button = item?.querySelector(':scope > .accordion-item-label .accordion-item-toggle');
  if (button) setExpanded(button, true);
}

// Capture phase: works whether the editor dispatches the event on the element or on the
// document. One listener per module, not per block, so re-decorated blocks do not pile up.
document.addEventListener('aue:ui-select', openOnEditorSelect, true);

/**
 * Decorates the accordion block.
 *
 * DOM de entrada (matriz EDS, contrato §3b) — one row per item:
 *   block
 *     └── div (item) × n
 *           ├── div  icon           <picture><img alt=iconAlt></picture>   (optional)
 *           ├── div  summary        <p>text</p>                            (required)
 *           ├── div  text           richtext                               (optional)
 *           ├── div  image1         <picture><img alt=image1Alt></picture> (optional)
 *           ├── div  image2         idem                                   (optional)
 *           ├── div  image3         idem                                   (optional)
 *           ├── div  image4         idem                                   (optional)
 *           ├── div  video          <p>URL</p> or <p><a href=URL>URL</a></p> (optional)
 *           ├── div  team           richtext                               (optional)
 *           └── div  document       <p><a href="/content/dam/….pdf" title=documentTitle>…</a></p>
 *
 * DOM de salida — WAI-ARIA accordion pattern (heading + button + panels):
 *   div.accordion-item
 *     ├── h3.accordion-item-label > button.accordion-item-toggle[aria-expanded][aria-controls]
 *     ├── div.accordion-item-body[hidden]
 *     │     ├── div.accordion-item-text
 *     │     ├── ul.accordion-item-gallery > li > picture
 *     │     └── div.accordion-item-details
 *     │           ├── div.accordion-item-credits > h4 «Team Members», div.accordion-item-team
 *     │           └── div.accordion-item-video > iframe
 *     └── div.accordion-item-document[hidden] (the original cell) > p > a «Discover More»
 *
 * Items open and close independently: opening one does not close the others (orchestrator
 * decision, 1:1 with the portal measured live).
 *
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  [...block.children].forEach(decorateItem);

  // One resource per block: a fragment is decorated before it is attached to the document
  // (indexOf is -1), so a detached block gets its own suffix, as in embed and media-text.
  const position = [...document.querySelectorAll('.accordion')].indexOf(block);
  instrumentFallback(block, position >= 0 ? position : `detached-${detachedCount += 1}`);

  if (wiredBlocks.has(block)) return;
  wiredBlocks.add(block);
  block.addEventListener('click', (event) => {
    const button = event.target.closest('.accordion-item-toggle');
    if (!button || !block.contains(button)) return;
    setExpanded(button, button.getAttribute('aria-expanded') !== 'true');
  });
}
