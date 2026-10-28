/**
 * Carousel Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-008 (.eds-pipeline/contracts/carousel.md)
 * Base: Adobe Block Collection (carousel) @ commit 5ad878ba, extended with optional fields
 *   (title, text, link) and the variants gallery, logos, cards, testimonial and blog
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - Ends, 1:1 with the portal (orchestrator decision): the carousel stops at the first and
 *   last position in every variant, no loop. The arrow at an end gets aria-disabled="true"
 *   (not disabled, so it keeps the focus) and does nothing when pressed; as on the portal,
 *   only cards dims it (.scroll-btn:disabled { opacity: .3 }). Closes the blocking TODO of
 *   navigate().
 * - The arrows follow the scroll position (scroll and intersection), so they are right after
 *   a swipe, a keyboard scroll or a dot, not only after a click on an arrow.
 * - Fallback data-aue-* only when AEM has not instrumented the block (local drafts, preview),
 *   never over the attributes AEM delivers, which moveInstrumentation() keeps.
 * - Universal Editor: selecting an item that is out of view scrolls the carousel to it
 *   (aue:ui-select).
 */

import { toCamelCase } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/** Cells of each item, in model order (contract §3b). */
const CELL_ORDER = ['media', 'title', 'text', 'link'];

/**
 * Fallback labels, used only when the site placeholders do not define the keys.
 * The site text lives in /placeholders.json (keys carousel, carouselPrevious,
 * carouselNext, carouselSlide and carouselSlides). {current} and {total} are replaced.
 */
const DEFAULT_LABELS = {
  carousel: 'carousel',
  carouselPrevious: 'Previous slide',
  carouselNext: 'Next slide',
  carouselSlide: 'Slide {current} of {total}',
  carouselSlides: 'Choose a slide',
};

/** Variants without dot indicators in the portal captures (contract §2). */
const NO_INDICATORS = ['cards', 'blog'];

/** Dots shown at once by the logos variant (portal: 7 dynamic dots). */
const DOT_WINDOW = 7;

/** Variants whose arrows step a whole page of visible slides (blog: 10 slides of 2, DH-02). */
const PAGED = ['blog'];

/** Inline icons of the arrow buttons (decorative; the button carries the name). */
const ICONS = {
  chevron: '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M12 6l10 10-10 10" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  arrow: '<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false"><path d="M5 14h18M16 7l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};

/** Universal Editor labels: the same labels as models[] in _carousel.json. */
const UE_LABELS = {
  block: 'Carrusel',
  item: 'Diapositiva',
  media_image: 'Imagen',
  title: 'Título',
  text: 'Texto',
  link: 'Enlace',
};

let carouselCount = 0;
let placeholdersRequest;

/**
 * Fetches the site placeholders once (/placeholders.json, rows Key/Text) and
 * returns them keyed both as written and in camelCase: toCamelCase lowercases
 * camelCase keys (carouselNext -> carouselnext), so the raw key must stay readable.
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
 * @param {string} template label with {current} and {total}
 * @param {number} current 1-based position
 * @param {number} total number of slides
 * @returns {string} the label
 */
function formatLabel(template, current, total) {
  return template.replace('{current}', current).replace('{total}', total);
}

/**
 * @param {?Element} cell item cell
 * @returns {boolean} true when the author left the field empty
 */
function isEmptyCell(cell) {
  return !cell || (!cell.textContent.trim() && !cell.querySelector('picture, img'));
}

/**
 * @param {Element} cell item cell
 * @returns {boolean} true when the cell holds one link and nothing else
 */
function isLinkCell(cell) {
  const links = cell.querySelectorAll('a[href]');
  return links.length === 1
    && !cell.querySelector('picture, img, h1, h2, h3, h4, h5, h6')
    && cell.textContent.trim() === links[0].textContent.trim();
}

/**
 * @param {Element[]} cells item cells, fewer than the model
 * @returns {boolean} true when the cells are the model with its last fields omitted:
 *   each one fits the field of its position (image, plain text, single link)
 */
function isModelPrefix(cells) {
  return cells.length < CELL_ORDER.length && cells.every((cell, index) => {
    if (isEmptyCell(cell)) return true;
    const hasMedia = Boolean(cell.querySelector('picture, img'));
    if (CELL_ORDER[index] === 'media') return hasMedia;
    if (CELL_ORDER[index] === 'link') return isLinkCell(cell);
    return !hasMedia && !isLinkCell(cell);
  });
}

/**
 * Maps the cells of an item to the model fields. The full model delivers the four
 * cells in order (contract §3b), so they are read by position; so are fewer cells when
 * they are that order with the last fields omitted (an item without link, or without
 * text and link). Otherwise they are classified by their content: image, single link,
 * then title and text.
 * @param {Element[]} cells item cells
 * @returns {{media: ?Element, title: ?Element, text: ?Element, link: ?Element,
 *   empty: Element[]}} cells per field (empty: cells the author left blank)
 */
function mapCells(cells) {
  const fields = {
    media: null, title: null, text: null, link: null, empty: [],
  };

  // [ANTES] only four cells were read by position: with the link omitted, an item with a
  // title and no text showed its title as text (no heading), in cards, testimonial and blog
  if (cells.length === CELL_ORDER.length || isModelPrefix(cells)) {
    cells.forEach((cell, index) => {
      if (isEmptyCell(cell)) fields.empty.push(cell);
      else fields[CELL_ORDER[index]] = cell;
    });
    return fields;
  }

  const textCells = [];
  cells.forEach((cell) => {
    if (isEmptyCell(cell)) fields.empty.push(cell);
    else if (!fields.media && cell.querySelector('picture, img')) fields.media = cell;
    else if (!fields.link && isLinkCell(cell)) fields.link = cell;
    else textCells.push(cell);
  });
  if (textCells.length > 1) fields.title = textCells.shift();
  [fields.text] = textCells;
  return fields;
}

/**
 * Turns the plain-text title into an h3 (the section heading before the block is an h2),
 * keeping the authored text and its Universal Editor attributes.
 * @param {Element} cell title cell
 * @param {string} id id for the heading
 * @returns {Element} the heading
 */
function decorateTitle(cell, id) {
  let heading = cell.querySelector('h1, h2, h3, h4, h5, h6');
  if (!heading) {
    heading = document.createElement('h3');
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
  }
  heading.id = id;
  return heading;
}

/**
 * Decorates the link cell. A link without authored text (only the URL) and with a title
 * becomes the link of the whole slide, named by the title (blog: card fully linked).
 * @param {Element} slide the slide
 * @param {Element} cell link cell
 * @param {?Element} titleNode node that names the slide
 */
function decorateLink(slide, cell, titleNode) {
  const link = cell.querySelector('a[href]');
  if (!link) return;
  const text = link.textContent.trim();
  const hasText = Boolean(text) && text !== link.getAttribute('href') && text !== link.href;
  if (hasText || !titleNode) return;

  if (!titleNode.id) titleNode.id = `${slide.id}-title`;
  slide.classList.add('carousel-slide-linked');
  link.setAttribute('aria-labelledby', titleNode.id);
  // the URL xwalk writes as text when linkText is empty is not a label (WCAG 2.5.3)
  const url = document.createElement('span');
  url.hidden = true;
  url.append(...link.childNodes);
  link.append(url);
  // decorateButtons copies the URL into the title: it would be read as a description
  if (link.title === text) link.removeAttribute('title');
}

/**
 * Builds a slide from an item row, moving the authored cells into it.
 * @param {Element} block the block
 * @param {Element} row item row
 * @param {number} index position of the slide
 * @returns {Element} the slide
 */
function createSlide(block, row, index) {
  const slide = document.createElement('li');
  slide.className = 'carousel-slide';
  slide.id = `${block.id}-slide-${index + 1}`;
  slide.dataset.slideIndex = index;

  const fields = mapCells([...row.children]);
  const isTestimonial = block.classList.contains('testimonial');

  if (fields.media) {
    fields.media.classList.add('carousel-slide-image');
    fields.media.querySelectorAll('img').forEach((img) => {
      // never above the fold (contract §6): every slide image loads lazily
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
    });
    slide.append(fields.media);
  }

  const content = document.createElement('div');
  content.className = 'carousel-slide-content';

  let titleNode = null;
  if (fields.title) {
    fields.title.classList.add('carousel-slide-title');
    titleNode = isTestimonial
      ? fields.title.querySelector('p') || fields.title
      : decorateTitle(fields.title, `${slide.id}-title`);
  }
  if (fields.text) fields.text.classList.add('carousel-slide-text');
  if (fields.link) {
    fields.link.classList.add('carousel-slide-link');
    decorateLink(slide, fields.link, titleNode);
  }

  // testimonial: the quote comes before the name, as on the portal
  const order = isTestimonial
    ? [fields.text, fields.title, fields.link]
    : [fields.title, fields.text, fields.link];
  order.filter(Boolean).forEach((cell) => content.append(cell));

  // blank cells stay in the slide (they keep their place for the editor), hidden
  fields.empty.forEach((cell) => {
    cell.hidden = true;
    content.append(cell);
  });

  if (content.children.length) slide.append(content);
  return slide;
}

/**
 * Gives the region an accessible name: the heading authored right before the block
 * (contract §3c: the h2 goes as default content before it), or the fallback label.
 * @param {Element} block the block
 * @param {Object<string, string>} labels labels in use
 */
function labelRegion(block, labels) {
  const wrapper = block.parentElement?.classList.contains('carousel-wrapper') ? block.parentElement : block;
  const previous = wrapper.previousElementSibling;
  const headings = previous ? previous.querySelectorAll('h1, h2, h3, h4, h5, h6') : [];
  const heading = headings[headings.length - 1];
  if (heading) {
    if (!heading.id) heading.id = `${block.id}-heading`;
    block.setAttribute('aria-labelledby', heading.id);
    block.removeAttribute('aria-label');
  } else {
    block.setAttribute('aria-label', labels.carousel);
  }
}

/**
 * Writes the labels of the region, the slides and the controls.
 * @param {Element} block the block
 * @param {Object<string, string>} labels labels in use
 */
function applyLabels(block, labels) {
  block.setAttribute('aria-roledescription', labels.carousel);
  if (block.hasAttribute('aria-label')) block.setAttribute('aria-label', labels.carousel);

  const slides = block.querySelectorAll('.carousel-slide');
  slides.forEach((slide, index) => {
    slide.setAttribute('aria-label', formatLabel(labels.carouselSlide, index + 1, slides.length));
  });

  block.querySelector('.slide-prev')?.setAttribute('aria-label', labels.carouselPrevious);
  block.querySelector('.slide-next')?.setAttribute('aria-label', labels.carouselNext);

  const indicators = block.querySelector('.carousel-slide-indicators');
  if (indicators) {
    indicators.setAttribute('aria-label', labels.carouselSlides);
    indicators.querySelectorAll('button').forEach((button, index) => {
      button.setAttribute('aria-label', formatLabel(labels.carouselSlide, index + 1, slides.length));
    });
  }
}

/**
 * Loads the site placeholders the first time someone engages with the carousel
 * (pointer, touch or keyboard focus) and refreshes the labels. The English fallback
 * is in place from the start, so nothing is fetched while the page loads.
 * @param {Element} block the block
 */
function schedulePlaceholders(block) {
  const events = ['pointerenter', 'touchstart', 'focusin'];
  const load = () => {
    events.forEach((name) => block.removeEventListener(name, load));
    fetchPlaceholders().then((placeholders) => {
      const labels = { ...DEFAULT_LABELS };
      Object.keys(labels).forEach((key) => {
        if (placeholders[key]) labels[key] = placeholders[key];
      });
      applyLabels(block, labels);
    });
  };
  events.forEach((name) => block.addEventListener(name, load, { passive: true }));
}

/**
 * Dynamic dots of the logos variant, 1:1 with the portal: a window of DOT_WINDOW dots that
 * follows the current slide. The current dot is full size, its neighbours 0.75, the two
 * ends of the window 0.5 and the rest 0.65 (CSS reads data-dot).
 * @param {Element} block the block
 * @param {number} current index of the current slide
 */
function updateDynamicDots(block, current) {
  const items = [...block.querySelectorAll('.carousel-slide-indicator')];
  const size = Math.min(DOT_WINDOW, items.length);
  const start = Math.max(0, Math.min(current - Math.floor(size / 2), items.length - size));
  const end = start + size - 1;
  items.forEach((item, index) => {
    item.hidden = index < start || index > end;
    if (index === current) delete item.dataset.dot;
    else if (index === start || index === end) item.dataset.dot = 'edge';
    else if (Math.abs(index - current) === 1) item.dataset.dot = 'near';
    else delete item.dataset.dot;
  });
}

/**
 * Marks the visible slides as active: shown to assistive technology and with their
 * links focusable; the rest hidden and out of the tab order (contract §7).
 * @param {Element} block the block
 * @param {Set<number>} visible indexes of the slides at least half visible
 */
function updateActiveSlides(block, visible) {
  if (!visible.size) return;
  const first = Math.min(...visible);
  block.dataset.activeSlide = first;

  block.querySelectorAll('.carousel-slide').forEach((slide, index) => {
    const active = visible.has(index);
    slide.setAttribute('aria-hidden', String(!active));
    slide.querySelectorAll('a[href]').forEach((link) => {
      if (active) link.removeAttribute('tabindex');
      else link.setAttribute('tabindex', '-1');
    });
  });

  block.querySelectorAll('.carousel-slide-indicator button').forEach((button, index) => {
    if (index === first) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  if (block.classList.contains('logos')) updateDynamicDots(block, first);

  const counter = block.querySelector('.carousel-counter');
  if (counter) counter.dataset.current = first + 1;
}

/**
 * Scrolls the slide into place. The scroll observer then updates the active state.
 * @param {Element} block the block
 * @param {number} index slide to show
 */
export function showSlide(block, index) {
  const slides = block.querySelectorAll('.carousel-slide');
  const slide = slides[Math.max(0, Math.min(index, slides.length - 1))];
  if (!slide) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  block.querySelector('.carousel-slides').scrollTo({
    top: 0,
    left: slide.offsetLeft,
    behavior: reduceMotion ? 'auto' : 'smooth',
  });
}

/**
 * @param {Element} scroller the .carousel-slides list
 * @returns {{atStart: boolean, atEnd: boolean}} whether the scroller is at either end
 */
function scrollEnds(scroller) {
  return {
    atStart: scroller.scrollLeft <= 1,
    atEnd: scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1,
  };
}

/**
 * Marks the arrow of an end as inactive. aria-disabled, not disabled: the button keeps
 * the focus when the carousel reaches the end (a disabled button would drop it).
 * @param {Element} block the block
 */
function updateArrows(block) {
  const scroller = block.querySelector('.carousel-slides');
  if (!scroller) return;
  const { atStart, atEnd } = scrollEnds(scroller);
  block.querySelector('.slide-prev')?.setAttribute('aria-disabled', String(atStart));
  block.querySelector('.slide-next')?.setAttribute('aria-disabled', String(atEnd));
}

/**
 * Moves one step back or forward. The step is one slide, or a page of visible slides
 * in the paged variants. The carousel stops at both ends, no loop (1:1 with the portal):
 * the arrow of an end does nothing.
 * @param {Element} block the block
 * @param {number} direction -1 (previous) or 1 (next)
 */
function navigate(block, direction) {
  const scroller = block.querySelector('.carousel-slides');
  const { atStart, atEnd } = scrollEnds(scroller);
  if ((direction > 0 && atEnd) || (direction < 0 && atStart)) return;

  const visibleCount = block.querySelectorAll('.carousel-slide[aria-hidden="false"]').length;
  const step = PAGED.some((name) => block.classList.contains(name)) ? Math.max(1, visibleCount) : 1;
  const first = parseInt(block.dataset.activeSlide || '0', 10);
  showSlide(block, first + direction * step);
}

/**
 * Builds a previous/next button.
 * @param {string} className slide-prev or slide-next
 * @param {string} label accessible name
 * @param {string} icon inline svg
 * @returns {Element} the button
 */
function createArrow(className, label, icon) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  return button;
}

/**
 * Adds the previous/next buttons, the indicators and, in cards, the position counter.
 * @param {Element} block the block
 * @param {number} total number of slides
 * @param {Object<string, string>} labels labels in use
 */
function buildControls(block, total, labels) {
  const isCards = block.classList.contains('cards');
  const icon = isCards ? ICONS.arrow : ICONS.chevron;

  const buttons = document.createElement('div');
  buttons.className = 'carousel-navigation-buttons';
  buttons.append(createArrow('slide-prev', labels.carouselPrevious, icon));
  if (isCards) {
    // position shown between the arrows on mobile; drawn by CSS, the slides carry the label
    const counter = document.createElement('span');
    counter.className = 'carousel-counter';
    counter.setAttribute('aria-hidden', 'true');
    counter.dataset.current = 1;
    counter.dataset.total = total;
    buttons.append(counter);
  }
  buttons.append(createArrow('slide-next', labels.carouselNext, icon));
  block.prepend(buttons);

  if (NO_INDICATORS.some((name) => block.classList.contains(name))) return;
  const indicators = document.createElement('ol');
  indicators.className = 'carousel-slide-indicators';
  for (let index = 0; index < total; index += 1) {
    const item = document.createElement('li');
    item.className = 'carousel-slide-indicator';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.targetSlide = index;
    item.append(button);
    indicators.append(item);
  }
  block.append(indicators);
}

/**
 * Wires the controls and observes which slides are visible inside the scroller.
 * @param {Element} block the block
 */
function bindEvents(block) {
  block.querySelector('.slide-prev').addEventListener('click', () => navigate(block, -1));
  block.querySelector('.slide-next').addEventListener('click', () => navigate(block, 1));
  block.querySelectorAll('.carousel-slide-indicator button').forEach((button) => {
    button.addEventListener('click', () => showSlide(block, parseInt(button.dataset.targetSlide, 10)));
  });

  const scroller = block.querySelector('.carousel-slides');
  const slides = [...block.querySelectorAll('.carousel-slide')];
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const index = slides.indexOf(entry.target);
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) visible.add(index);
      else visible.delete(index);
    });
    updateActiveSlides(block, visible);
    updateArrows(block);
  }, { root: scroller, threshold: [0, 0.5, 1] });
  slides.forEach((slide) => observer.observe(slide));

  // the ends depend on the scroll position, which can still change after the last
  // intersection change (smooth scroll, swipe, keyboard): one update per frame at most
  let frame = 0;
  scroller.addEventListener('scroll', () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      updateArrows(block);
    });
  }, { passive: true });
}

/**
 * Sets the data-aue-* values that are missing on an element; never overwrites one.
 * @param {?Element} element
 * @param {Object<string, string>} values dataset keys and values
 */
function setMissing(element, values) {
  if (!element) return;
  Object.entries(values).forEach(([key, value]) => {
    if (!element.dataset[key]) element.dataset[key] = value;
  });
}

/**
 * Fallback instrumentation for Universal Editor. AEM delivers the data-aue-* attributes of
 * the block, its items and their fields when the page is opened in the editor, and
 * moveInstrumentation() keeps them through the decoration: those always win. This only runs
 * when the block arrives without them (local drafts, preview).
 * media_imageAlt and linkText collapse into the alt of the image and the text of the link,
 * so they share the node of their pair; classes is a block option, not a node. Cells the
 * author left empty are hidden and have no node to point at.
 * @param {Element} block the decorated block
 */
function instrumentFallback(block) {
  if (block.dataset.aueResource) return;
  // the block id (carousel-N), not its position in the document: a carousel inside a
  // fragment is decorated before the fragment is inserted, and would repeat a resource
  const base = `urn:aemconnection:${window.location.pathname}#${block.id}`;

  setMissing(block, {
    aueResource: base,
    aueType: 'container',
    aueFilter: 'carousel',
    aueModel: 'carousel',
    aueLabel: UE_LABELS.block,
    aueBehavior: 'component',
  });

  const field = (element, prop, type) => {
    if (element && !element.dataset.aueProp) {
      setMissing(element, { aueProp: prop, aueType: type, aueLabel: UE_LABELS[prop] });
    }
  };

  block.querySelectorAll('.carousel-slide').forEach((slide, index) => {
    const titleCell = slide.querySelector('.carousel-slide-title');
    const title = titleCell?.querySelector('h1, h2, h3, h4, h5, h6, p') || titleCell;
    setMissing(slide, {
      aueResource: `${base}/item-${index}`,
      aueType: 'component',
      aueModel: 'carousel-item',
      aueLabel: `${UE_LABELS.item}: ${title?.textContent.trim() || index + 1}`,
    });
    field(slide.querySelector('.carousel-slide-image img'), 'media_image', 'media');
    field(title, 'title', 'text');
    field(slide.querySelector('.carousel-slide-text'), 'text', 'richtext');
    field(slide.querySelector('.carousel-slide-link a[href]'), 'link', 'aem-content');
  });
}

/**
 * Universal Editor: when the author selects an item, or a field inside it, that is out of
 * view (content tree or properties rail), the carousel scrolls to that slide.
 * @param {CustomEvent} event aue:ui-select, detail { resource, selected }
 */
function showOnEditorSelect(event) {
  const { resource, selected } = event.detail || {};
  if (!selected) return;
  const target = (resource && [...document.querySelectorAll('[data-aue-resource]')]
    .find((element) => element.dataset.aueResource === resource))
    || (event.target instanceof Element ? event.target : null);
  const slide = target?.closest('.carousel .carousel-slide');
  if (!slide || slide.getAttribute('aria-hidden') === 'false') return;
  showSlide(slide.closest('.carousel'), parseInt(slide.dataset.slideIndex, 10));
}

// Capture phase: works whether the editor dispatches the event on the element or on the
// document. One listener per module, not per block, so re-decorated blocks do not pile up.
document.addEventListener('aue:ui-select', showOnEditorSelect, true);

/**
 * Decorates the carousel: one slide per item row (contract §3b), controls and state
 * (contract §7). The section heading before the block names the region.
 *
 * DOM de entrada (matriz EDS, contract §3b):
 *   div.carousel[.gallery|.logos|.cards|.testimonial|.blog]
 *     └── div (item carousel-item) × N
 *           ├── div  media: <picture> (media_image, alt = media_imageAlt)
 *           ├── div  title: <p> (texto plano)
 *           ├── div  text: richtext (<p>, <ul>, <h*>)
 *           └── div  link: <p><a href>linkText</a></p>
 *
 * DOM de salida:
 *   div.carousel[role=region][aria-roledescription]
 *     ├── div.carousel-navigation-buttons  button.slide-prev, [span.carousel-counter],
 *     │                                    button.slide-next  (only with 2+ slides)
 *     ├── div.carousel-slides-container
 *     │     └── ul.carousel-slides
 *     │           └── li.carousel-slide[aria-label][aria-hidden] × N
 *     │                 ├── div.carousel-slide-image  <picture>
 *     │                 └── div.carousel-slide-content
 *     │                       div.carousel-slide-title (h3) · div.carousel-slide-text ·
 *     │                       div.carousel-slide-link
 *     └── ol.carousel-slide-indicators  li.carousel-slide-indicator > button × N
 *
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  // already decorated (a copy of a rendered block): nothing to restructure
  if (block.querySelector(':scope > .carousel-slides-container')) return;

  carouselCount += 1;
  block.id = block.id || `carousel-${carouselCount}`;
  const labels = { ...DEFAULT_LABELS };

  const rows = [...block.querySelectorAll(':scope > div')];

  block.setAttribute('role', 'region');
  labelRegion(block, labels);

  const container = document.createElement('div');
  container.className = 'carousel-slides-container';
  const slidesWrapper = document.createElement('ul');
  slidesWrapper.className = 'carousel-slides';

  rows.forEach((row, index) => {
    const slide = createSlide(block, row, index);
    moveInstrumentation(row, slide);
    slidesWrapper.append(slide);
    row.remove();
  });

  // without links inside, the scroller itself takes focus so the keyboard can scroll it
  if (!slidesWrapper.querySelector('a[href]')) slidesWrapper.tabIndex = 0;

  container.append(slidesWrapper);
  block.prepend(container);

  if (rows.length > 1) {
    buildControls(block, rows.length, labels);
    bindEvents(block);
    updateArrows(block);
  } else {
    slidesWrapper.querySelectorAll('.carousel-slide').forEach((slide) => slide.setAttribute('aria-hidden', 'false'));
  }

  applyLabels(block, labels);
  schedulePlaceholders(block);
  instrumentFallback(block);
}
