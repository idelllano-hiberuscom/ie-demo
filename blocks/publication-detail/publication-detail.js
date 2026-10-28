/**
 * Publication Detail Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-010 (.eds-pipeline/contracts/publication-detail.md)
 * Base: none, new block (contract §1). The PDF link follows rule R7 as validated in the
 *   accordion (EDS-COMP-013): a reference to a PDF is a download link with its title.
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - Universal Editor fallback instrumentation (instrumentBlock): only when AEM has not
 *   instrumented the block, never over the attributes AEM delivers. One resource per block;
 *   blocks decorated inside a fragment (detached from the document) get one of their own.
 * - Document given as a bare path: the instrumentation of its paragraph now moves to the dd
 *   (it was dropped with the row, because the generated link is not inside that paragraph).
 * - Hover and active of the PDF link: closed by orchestrator decision (see note below).
 */

// [EDS-COMP-010] Hover and active of the PDF link are not in the evidence (contract §7) and
// are not invented: by orchestrator decision the link keeps the global a:hover (underline and
// --link-hover-color) and the global focus ring, as the hero CTA does. Closes the contract §7 TODO.

import { toCamelCase } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/** One row per field, in model order (contract §3b). imageAlt and documentText collapse. */
const FIELD_ORDER = ['image', 'authors', 'document', 'abstract'];

/**
 * Fallback labels, used only when the site placeholders do not define the keys.
 * The site texts live in /placeholders.json (contract §1: the labels are i18n, not fields).
 */
const DEFAULT_LABELS = {
  publicationAuthors: 'Author(s)',
  publicationDocument: 'Publication',
  publicationDownload: 'Download the publication',
  pdf: 'PDF',
};

/** Universal Editor labels of the fallback instrumentation (fields of _publication-detail.json). */
const UE_LABELS = {
  block: 'Ficha de publicación',
  image: 'Portada',
  authors: 'Autores',
  document: 'Documento PDF',
  abstract: 'Resumen',
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
      .then((json) => Object.fromEntries((json.data || [])
        .filter((row) => row.Key && row.Text)
        .flatMap((row) => [[toCamelCase(row.Key), row.Text], [row.Key, row.Text]])))
      .catch(() => ({}));
  }
  return placeholdersRequest;
}

/**
 * @param {Element} row block row
 * @returns {Element} the cell of the row (the row itself when it has no cell)
 */
function cellOf(row) {
  const cell = row.firstElementChild;
  return cell && cell.tagName === 'DIV' ? cell : row;
}

/**
 * @param {Element} row block row
 * @returns {boolean} true when the author left the field empty
 */
function isEmptyRow(row) {
  return !row.textContent.trim() && !row.querySelector('picture, img, a[href]');
}

/**
 * Tells whether a text is a raw reference (a path, a URL or a file name) and not a title.
 * @param {string} value
 * @returns {boolean}
 */
function isRawReference(value) {
  return /^(https?:)?\/|^\.{0,2}\/|\.pdf(\?|#|$)/i.test(value);
}

/**
 * @param {Element} row block row
 * @returns {boolean} true when the row holds a document: a link or a bare path
 */
function isDocumentRow(row) {
  const text = row.textContent.trim();
  return Boolean(row.querySelector('a[href]')) || (!/\s/.test(text) && isRawReference(text));
}

/**
 * Maps the rows to the contract fields. The full model delivers one row per field, so rows
 * are read by position. Fewer rows (content authored by hand) are classified by content:
 * picture, document link or path, a first text row (authors) and the rest (abstract).
 * @param {Element[]} rows block rows
 * @returns {{image: ?Element, authors: ?Element, document: ?Element, abstract: Element[]}}
 */
function mapRows(rows) {
  const fields = {
    image: null, authors: null, document: null, abstract: [],
  };

  if (rows.length === FIELD_ORDER.length) {
    const [image, authors, documentRow, abstract] = rows
      .map((row) => (isEmptyRow(row) ? null : row));
    return {
      image, authors, document: documentRow, abstract: abstract ? [abstract] : [],
    };
  }

  rows.filter((row) => !isEmptyRow(row)).forEach((row) => {
    if (!fields.image && row.querySelector('picture, img')) fields.image = row;
    else if (!fields.document && isDocumentRow(row)) fields.document = row;
    else if (!fields.authors) fields.authors = row;
    else fields.abstract.push(row);
  });
  return fields;
}

/**
 * Moves the authored content of a single-value row into a new element. A lone paragraph is
 * unwrapped; its Universal Editor attributes (and the cell's) follow the content.
 * @param {Element} row block row
 * @param {Element} target element that receives the content
 */
function moveFieldContent(row, target) {
  const cell = cellOf(row);
  moveInstrumentation(cell, target);
  const [first] = cell.children;
  if (cell.children.length === 1 && first.tagName === 'P') {
    moveInstrumentation(first, target);
    target.append(...first.childNodes);
  } else {
    target.append(...cell.childNodes);
  }
}

/**
 * Applies the loading policy of contract §6: the cover is the LCP candidate only when the
 * block is in the first section of the page. Keeps the author alt; no alt means decorative.
 * @param {Element} row image row
 * @param {boolean} isLcp true when the block is in the first section
 */
function prepareCover(row, isLcp) {
  row.querySelectorAll('img').forEach((img) => {
    if (isLcp) {
      img.setAttribute('loading', 'eager');
      img.setAttribute('fetchpriority', 'high');
    } else {
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
    }
    if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
  });
}

/**
 * Builds the document link (rule R7): the reference to the PDF in the DAM, with
 * documentText as its visible text and accessible name, "(PDF)" for screen readers and
 * the download attribute. Accepts <p><a href>…</a></p> or a bare path written as text;
 * without documentText the link shows the publicationDownload label.
 * @param {Element} row document row
 * @param {Array<Function>} relabel callbacks run with the site labels once they load
 * @returns {?HTMLAnchorElement} the link, or null when the row holds no reference
 */
function buildDocumentLink(row, relabel) {
  let link = row.querySelector('a[href]');
  if (!link) {
    const raw = row.textContent.trim();
    if (!isRawReference(raw)) return null;
    link = document.createElement('a');
    link.href = raw;
  }

  const href = link.getAttribute('href');
  const text = link.textContent.trim();
  const hasTitle = Boolean(text) && text !== href && !isRawReference(text);
  link.className = 'publication-detail-link';

  if (!hasTitle) {
    const fallback = document.createTextNode(DEFAULT_LABELS.publicationDownload);
    link.textContent = '';
    link.append(fallback);
    relabel.push((labels) => { fallback.data = labels.publicationDownload; });
  }

  // decorateButtons() copies the link text into an empty title: a title that repeats the
  // visible text or the raw reference adds nothing.
  const title = (link.getAttribute('title') || '').trim();
  if (!title || title === text || title === href || isRawReference(title)) {
    link.removeAttribute('title');
  }

  let isPdf;
  try {
    isPdf = /\.pdf$/i.test(new URL(href, window.location.href).pathname);
  } catch {
    isPdf = /\.pdf(\?|#|$)/i.test(href);
  }
  if (isPdf) {
    link.setAttribute('download', '');
    const context = document.createElement('span');
    context.className = 'publication-detail-link-context';
    context.textContent = ` (${DEFAULT_LABELS.pdf})`;
    link.append(context);
    relabel.push((labels) => { context.textContent = ` (${labels.pdf})`; });
  }
  return link;
}

/**
 * Builds one term of the description list: <div><dt>label</dt><dd>value</dd></div>.
 * @param {string} key placeholder key of the label
 * @param {Element} value the dd
 * @param {Array<Function>} relabel callbacks run with the site labels once they load
 * @returns {HTMLDivElement}
 */
function buildTerm(key, value, relabel) {
  const term = document.createElement('div');
  const label = document.createElement('dt');
  label.textContent = DEFAULT_LABELS[key];
  relabel.push((labels) => { label.textContent = labels[key]; });
  term.append(label, value);
  return term;
}

/**
 * Sets the data-aue-* of one field, unless the element already has a property.
 * @param {?Element} element
 * @param {string} prop data-aue-prop (field name in models[])
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
 * the content (moveInstrumentation) and are never overwritten. Only a block AEM has not
 * instrumented (local drafts, preview) gets this fallback, with a resource built from the
 * page path. imageAlt and documentText collapse into the img alt and the link text, so they
 * own no element of their own.
 * @param {Element} block
 * @param {{image: ?Element, authors: ?Element, link: ?Element, abstract: Element[]}} nodes
 */
function instrumentBlock(block, nodes) {
  if (block.dataset.aueResource) return;
  // One resource per block: Universal Editor looks blocks up by data-aue-resource. A fragment
  // is decorated before it is attached to the document, so its blocks get their own suffix.
  const position = [...document.querySelectorAll('.publication-detail')].indexOf(block);
  const suffix = position >= 0 ? position : `detached-${detachedCount += 1}`;
  block.dataset.aueResource = `urn:aemconnection:${window.location.pathname}#publication-detail-${suffix}`;
  block.dataset.aueType = 'component';
  block.dataset.aueModel = 'publication-detail';
  block.dataset.aueLabel = UE_LABELS.block;

  instrumentField(nodes.image?.querySelector('img'), 'image', 'media');
  instrumentField(nodes.authors, 'authors', 'text');
  instrumentField(nodes.link, 'document', 'media');
  instrumentField(nodes.abstract[0] && cellOf(nodes.abstract[0]), 'abstract', 'richtext');
}

/**
 * Decorates the publication-detail block.
 *
 * DOM de entrada (matriz EDS, contrato §3b) — one row per field, one cell per row:
 *   div.publication-detail
 *     ├── div > div > picture > img     image (alt = imageAlt, optional)
 *     ├── div > div > p                 authors (plain text, required)
 *     ├── div > div > p > a[href]       document (reference to the PDF in the DAM, required;
 *     │                                 text = documentText, optional; a bare path is accepted)
 *     └── div > div > p | ul | h*       abstract (richtext, optional)
 *   Empty fields arrive as empty rows and stay in the block, hidden.
 *
 * DOM de salida (contrato §3d, with the abstract as a sibling: in the captures it runs
 * full width under the cover and the metadata, not inside the metadata column):
 *   div.publication-detail
 *     ├── div.publication-detail-cover          image row > div > picture
 *     ├── div.publication-detail-meta > dl
 *     │     ├── div > dt «Author(s)» + dd (authors)
 *     │     └── div > dt «Publication» + dd > a.publication-detail-link[download]
 *     │                                        > text + span.publication-detail-link-context
 *     └── div.publication-detail-abstract       abstract row
 *
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  const rows = [...block.children];
  const fields = mapRows(rows);
  const relabel = [];

  rows.filter(isEmptyRow).forEach((row) => { row.hidden = true; });

  if (fields.image) {
    const section = block.closest('.section');
    const isFirstSection = Boolean(section) && section === document.querySelector('main > .section');
    fields.image.classList.add('publication-detail-cover');
    prepareCover(fields.image, isFirstSection);
  }

  const list = document.createElement('dl');
  let authors = null;

  if (fields.authors) {
    authors = document.createElement('dd');
    moveFieldContent(fields.authors, authors);
    list.append(buildTerm('publicationAuthors', authors, relabel));
    fields.authors.remove();
  }

  const link = fields.document && buildDocumentLink(fields.document, relabel);
  if (link) {
    const value = document.createElement('dd');
    const cell = cellOf(fields.document);
    moveInstrumentation(cell, value);
    // [QA] [ANTES] only link.closest('p'): with a bare path the link is created outside the
    // paragraph and the paragraph's data-aue-* left with the row. [DESPUÉS] the paragraph of
    // the cell, whether or not it holds the link.
    const paragraph = link.closest('p') || cell.querySelector(':scope > p');
    if (paragraph && cell.contains(paragraph)) moveInstrumentation(paragraph, value);
    value.append(link);
    list.append(buildTerm('publicationDocument', value, relabel));
    fields.document.remove();
  } else if (fields.document) {
    fields.document.hidden = true;
  }

  fields.abstract.forEach((row) => row.classList.add('publication-detail-abstract'));

  if (list.children.length) {
    const meta = document.createElement('div');
    meta.className = 'publication-detail-meta';
    meta.append(list);
    const [firstAbstract] = fields.abstract;
    if (firstAbstract) firstAbstract.before(meta);
    else block.append(meta);
  }

  instrumentBlock(block, {
    image: fields.image, authors, link, abstract: fields.abstract,
  });

  if (relabel.length) {
    fetchPlaceholders().then((placeholders) => {
      const labels = Object.fromEntries(Object.entries(DEFAULT_LABELS)
        .map(([key, value]) => [key, placeholders[key] || value]));
      relabel.forEach((apply) => apply(labels));
    });
  }
}
