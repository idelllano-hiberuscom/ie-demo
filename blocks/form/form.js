/**
 * Form Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-015 (.eds-pipeline/contracts/form.md)
 * Base: Adobe Block Collection (form) @ commit 5ad878ba, adapted: fields are block items
 * instead of a referenced sheet, and the submit goes to an author-configured mock URL.
 * Model: xwalk (EDS + Universal Editor) — blocks/form/_form.json
 * UE instrumentation: ✅ Completado (Fase 3)
 * QA audit: ✅ Validado
 *
 * QA Changes:
 * - Item fields renamed for xwalk: name → fieldName (the block/item resource stores its own
 *   `name` property, the label of the Content Tree) and helpText → help (xwalk/no-orphan-
 *   collapsible-fields: a field ending in "Text" collapses into a base field that does not exist).
 * - Item cells are resolved by their data-aue-prop when AEM instruments them, by position
 *   otherwise; a positional cell that belongs to another property is never read.
 * - Item rows are also recognised by data-aue-model="form-field", not only by their cell count.
 * - UE instrumentation preserved through decoration (moveInstrumentation) for the title and
 *   the submit label; synthetic data-aue-* only where AEM did not render them.
 * - Success and error texts come from /placeholders.json (formSuccess, formError), fetched once
 *   on the first interaction with the form, with the English texts as fallback.
 * - Consent label: only phrasing content goes into <label> (paragraphs joined by <br>).
 * - Validation listeners delegated on the form instead of two per control.
 */
import { toCamelCase, toClassName } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

/** Cells of a form-field item, in model order (contract §3b; field names of _form.json). */
const ITEM_CELLS = ['fieldName', 'type', 'label', 'required', 'options', 'help'];

/** Item fields edited with the rich text editor (the rest are plain text). */
const RICHTEXT_CELLS = ['options', 'help'];

/** Author-facing labels of the Universal Editor fields. */
const AUE_LABELS = {
  title: 'Título del formulario',
  submitLabel: 'Texto del botón de envío',
  action: 'URL de envío (mock)',
  fieldName: 'Nombre técnico del campo',
  type: 'Tipo de campo',
  label: 'Etiqueta (placeholder)',
  required: 'Obligatorio',
  options: 'Opciones',
  help: 'Texto de ayuda o consentimiento',
};

/** Input types the block renders as <input>; anything else falls back to text. */
const INPUT_TYPES = ['text', 'email', 'tel', 'url', 'number', 'date'];

/** WCAG 1.3.5: autocomplete purpose that can be derived from the type alone. */
const AUTOCOMPLETE_BY_TYPE = { email: 'email', tel: 'tel', url: 'url' };

/**
 * Fallback texts of the submission result, used only when the site placeholders do not define
 * the keys. The site text lives in /placeholders.json (keys formSuccess and formError).
 */
const DEFAULT_STATUS_TEXT = {
  formSuccess: 'Thank you. Your request has been sent.',
  formError: 'Sorry, your request could not be sent. Please try again later.',
};

const usedIds = {};

let placeholdersRequest;

/**
 * Fetches the site placeholders once (/placeholders.json, rows Key/Text). Keys are available
 * as written and in camelCase. Any failure resolves to an empty object.
 * @returns {Promise<Object<string, string>>}
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
 * Unique, stable id for an element of the form.
 * @param {string} base Seed for the id
 * @returns {string}
 */
function uniqueId(base) {
  const slug = toClassName(base);
  usedIds[slug] = (usedIds[slug] || 0) + 1;
  return usedIds[slug] > 1 ? `${slug}-${usedIds[slug]}` : slug;
}

/**
 * Plain text of a cell.
 * @param {Element|undefined} cell
 * @returns {string}
 */
function cellText(cell) {
  return cell ? cell.textContent.trim() : '';
}

/**
 * UE property an element (or its content) is bound to, as rendered by AEM.
 * @param {Element} element
 * @returns {string|undefined}
 */
function boundProp(element) {
  const bound = element.matches('[data-aue-prop], [data-richtext-prop]')
    ? element
    : element.querySelector('[data-aue-prop], [data-richtext-prop]');
  return bound ? bound.dataset.aueProp || bound.dataset.richtextProp : undefined;
}

/**
 * Submit URL from the action cell; only http(s) URLs are accepted.
 * @param {Element|undefined} cell
 * @returns {string} Absolute URL, or '' when missing or unsafe
 */
function readAction(cell) {
  const link = cell?.querySelector('a[href]');
  const raw = link ? link.getAttribute('href') : cellText(cell);
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

/**
 * Whether a config row holds the action URL (used only when rows are missing).
 * @param {Element} row
 * @returns {boolean}
 */
function looksLikeUrl(row) {
  return Boolean(row.querySelector('a[href]')) || /^(https?:)?\/\/|^\//.test(cellText(row));
}

/**
 * Maps the single-cell rows to the block fields title, submitLabel and action (contract §3b).
 * Rows bound to a UE property are mapped by it; the rest tolerate omitted rows.
 * @param {Element[]} rows
 * @returns {{title?: Element, submitLabel?: Element, action?: Element}}
 */
function mapConfigRows(rows) {
  const bound = Object.fromEntries(rows
    .map((row) => [boundProp(row), row])
    .filter(([prop]) => ['title', 'submitLabel', 'action'].includes(prop)));
  if (Object.keys(bound).length) return bound;

  if (rows.length >= 3) {
    const [title, submitLabel, action] = rows;
    return { title, submitLabel, action };
  }
  const action = rows.find(looksLikeUrl);
  const rest = rows.filter((row) => row !== action);
  if (rest.length === 2) return { title: rest[0], submitLabel: rest[1], action };
  return { submitLabel: rest[0], action };
}

/**
 * Text lines of a rich-text element, splitting paragraphs and <br>.
 * @param {Element} element
 * @returns {string[]}
 */
function textLines(element) {
  const lines = [''];
  element.childNodes.forEach((node) => {
    if (node.nodeName === 'BR') lines.push('');
    else lines[lines.length - 1] += node.textContent;
  });
  return lines.map((line) => line.trim()).filter(Boolean);
}

/**
 * Options of a select from the options cell. Reads the <option value>text</option> markup that
 * the contribution writes; as a fallback, list items or lines written as "value=text".
 * @param {Element|undefined} cell
 * @returns {{value: string, text: string}[]}
 */
function readOptions(cell) {
  if (!cell) return [];
  const options = [...cell.querySelectorAll('option')];
  if (options.length) {
    return options.map((option) => ({
      value: option.hasAttribute('value') ? option.getAttribute('value') : option.textContent.trim(),
      text: option.textContent.trim(),
    }));
  }
  const items = [...cell.querySelectorAll('li')];
  const lines = items.length
    ? items.map((item) => item.textContent.trim())
    : [...cell.querySelectorAll('p')].flatMap(textLines);
  return lines.filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    if (separator < 0) return { value: line, text: line };
    return { value: line.slice(0, separator).trim(), text: line.slice(separator + 1).trim() };
  });
}

/**
 * Accessible label text from the visible placeholder, without the required asterisk.
 * @param {string} text
 * @returns {string}
 */
function labelFromPlaceholder(text) {
  return text.replace(/\s*\*\s*$/, '').trim();
}

/**
 * Cell of an item row for a model field: the one AEM bound to that property, or the one in
 * its model position when that cell is not bound to another property.
 * @param {Element[]} cells
 * @param {string} key Field name
 * @param {number} index Position in the model
 * @returns {Element|undefined}
 */
function findCell(cells, key, index) {
  const bound = cells.find((cell) => boundProp(cell) === key);
  if (bound) return bound;
  const positional = cells[index];
  const prop = positional && boundProp(positional);
  return prop && prop !== key ? undefined : positional;
}

/**
 * Reads a form-field item row into a field definition.
 * @param {Element} row
 * @returns {object}
 */
function readField(row) {
  const rowCells = [...row.children];
  const cells = Object.fromEntries(ITEM_CELLS.map((key, i) => [key, findCell(rowCells, key, i)]));
  const options = readOptions(cells.options);
  const rawType = cellText(cells.type).toLowerCase();
  let type = rawType || (options.length ? 'select' : 'text');
  if (!['select', 'checkbox', ...INPUT_TYPES].includes(type)) type = 'text';
  return {
    row,
    cells,
    type,
    name: cellText(cells.fieldName),
    label: cellText(cells.label),
    required: /^(true|x|yes)$/i.test(cellText(cells.required)),
    options,
  };
}

/**
 * Visually hidden <label> for a control whose visible label is its placeholder (WCAG 3.3.2).
 * @param {string} id Id of the control
 * @param {string} text
 * @returns {HTMLLabelElement}
 */
function createHiddenLabel(id, text) {
  const label = document.createElement('label');
  label.className = 'form-label';
  label.htmlFor = id;
  label.textContent = text;
  return label;
}

/**
 * Applies the attributes shared by every control.
 * @param {HTMLElement} control
 * @param {object} field
 * @param {string} id
 */
function setCommonAttributes(control, field, id) {
  control.id = id;
  control.name = field.name;
  if (field.required) {
    control.required = true;
    control.setAttribute('aria-required', 'true');
  }
}

/**
 * Builds a text-like <input> (text, email, tel…).
 * @param {object} field
 * @param {string} id
 * @returns {{control: HTMLInputElement, label: HTMLLabelElement}}
 */
function buildInput(field, id) {
  const control = document.createElement('input');
  control.type = field.type;
  setCommonAttributes(control, field, id);
  if (field.label) control.placeholder = field.label;
  if (AUTOCOMPLETE_BY_TYPE[field.type]) control.autocomplete = AUTOCOMPLETE_BY_TYPE[field.type];
  const label = createHiddenLabel(id, labelFromPlaceholder(field.label) || field.name);
  return { control, label };
}

/**
 * Builds a <select>. With an empty label, its first option acts as placeholder (contract §7).
 * @param {object} field
 * @param {string} id
 * @returns {{control: HTMLSelectElement, label: HTMLLabelElement, choices: number}}
 */
function buildSelect(field, id) {
  const control = document.createElement('select');
  setCommonAttributes(control, field, id);
  const [first, ...others] = field.options;
  const placeholderText = field.label || first?.text || '';
  const choices = field.label ? field.options : others;

  if (placeholderText) {
    const placeholder = new Option(placeholderText, '', true, true);
    placeholder.disabled = true;
    control.add(placeholder);
  }
  choices.forEach(({ value, text }) => control.add(new Option(text, value)));

  const label = createHiddenLabel(id, labelFromPlaceholder(placeholderText) || field.name);
  return { control, label, choices: choices.length };
}

/**
 * Builds the consent checkbox; its label is the author's help text, links included.
 * @param {object} field
 * @param {string} id
 * @returns {{control: HTMLInputElement, label: HTMLLabelElement}}
 */
function buildCheckbox(field, id) {
  const control = document.createElement('input');
  control.type = 'checkbox';
  setCommonAttributes(control, field, id);
  control.value = field.options[0]?.value || 'true';

  const label = document.createElement('label');
  label.htmlFor = id;
  const source = field.cells.help;
  // <label> only admits phrasing content: the inline content of each paragraph is moved and
  // paragraphs are joined by <br>. Without paragraphs, only the text is kept.
  const paragraphs = source ? [...source.querySelectorAll('p')] : [];
  paragraphs.forEach((paragraph, i) => {
    if (i > 0) label.append(document.createElement('br'));
    label.append(...paragraph.childNodes);
  });
  if (!paragraphs.length && source) label.append(cellText(source));
  if (!label.textContent.trim()) label.textContent = field.label || field.name;
  return { control, label };
}

/**
 * Shows or clears the validation message of a control (aria-invalid + aria-describedby).
 * @param {HTMLElement} control
 * @param {string} message Empty string clears the error
 */
function setFieldError(control, message) {
  const error = document.getElementById(`${control.id}-error`);
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
  if (message) {
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', error.id);
  } else {
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }
}

/**
 * Validates one control with the constraint validation API; the message is the browser's,
 * so it follows the visitor's language without hardcoded copy.
 * @param {HTMLElement} control
 * @returns {boolean}
 */
function validateControl(control) {
  const valid = control.checkValidity();
  setFieldError(control, valid ? '' : control.validationMessage);
  return valid;
}

/**
 * Decorates an item row as a form field: the row becomes the field wrapper.
 * @param {object} field
 * @returns {HTMLElement|null} The control, or null when the row has no name
 */
function decorateField(field) {
  const { row } = field;
  if (!field.name) {
    row.hidden = true;
    return null;
  }
  const id = uniqueId(`form-${field.name}`);
  let kind = 'input';
  let built;
  if (field.type === 'select') {
    kind = 'select';
    built = buildSelect(field, id);
  } else if (field.type === 'checkbox') {
    kind = 'checkbox';
    built = buildCheckbox(field, id);
  } else {
    built = buildInput(field, id);
  }

  [...row.children].forEach((cell) => { cell.hidden = true; });
  row.classList.add('form-field', `form-field-${kind}`);

  const error = document.createElement('p');
  error.className = 'form-error';
  error.id = `${id}-error`;
  error.hidden = true;

  // Contract §3d: the checkbox sits inside its label, so the legal text wraps under it.
  if (kind === 'checkbox') built.label.prepend(built.control);
  else row.append(built.label);
  row.append(kind === 'checkbox' ? built.label : built.control, error);

  // Note [EDS-COMP-015]: a select without real options (the province, whose list depends on the
  // country and is not in the captured DOM — EV-03) is hidden and disabled, as in the original,
  // so it is neither validated nor sent. Closed by the orchestrator at Gate 2.
  if (kind === 'select' && !built.choices) {
    row.hidden = true;
    built.control.disabled = true;
  }
  return built.control;
}

/**
 * Collects the enabled, named controls as a flat object (Collection payload format).
 * @param {HTMLFormElement} form
 * @returns {object}
 */
function buildPayload(form) {
  const payload = {};
  [...form.elements].forEach((control) => {
    if (!control.name || control.disabled || control.type === 'submit') return;
    if (control.type === 'checkbox') {
      if (control.checked) payload[control.name] = control.value;
      return;
    }
    payload[control.name] = control.value;
  });
  return payload;
}

/**
 * Shows the submission result in the polite live region.
 * @param {HTMLElement} status
 * @param {'success'|'error'} result
 */
async function showStatus(status, result) {
  const key = result === 'success' ? 'formSuccess' : 'formError';
  const placeholders = await fetchPlaceholders();
  status.dataset.result = result;
  status.textContent = placeholders[key] || DEFAULT_STATUS_TEXT[key];
}

/**
 * POSTs the form to the mock action as JSON and reports the result accessibly.
 * @param {HTMLFormElement} form
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} status
 */
async function submitForm(form, button, status) {
  if (form.dataset.submitting === 'true') return;
  form.dataset.submitting = 'true';
  form.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-disabled', 'true');
  // The live region stays rendered and is emptied first, so every new result is announced.
  status.textContent = '';
  delete status.dataset.result;
  let result;
  try {
    if (!form.dataset.action) throw new Error('form: missing or invalid action URL');
    const response = await fetch(form.dataset.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: buildPayload(form) }),
    });
    if (!response.ok) throw new Error(`form: submission failed (${response.status})`);
    form.reset();
    result = 'success';
  } catch {
    result = 'error';
  }
  await showStatus(status, result);
  form.dataset.submitting = 'false';
  form.removeAttribute('aria-busy');
  button.removeAttribute('aria-disabled');
}

/**
 * Wires validation and submission.
 * @param {HTMLFormElement} form
 * @param {HTMLElement[]} controls
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} status
 */
function bindEvents(form, controls, button, status) {
  // The result texts are only needed after a submission: they are requested on the first
  // interaction, never during page load.
  form.addEventListener('focusin', () => fetchPlaceholders(), { once: true });

  // Delegated on the form: one listener per event, not one per control.
  form.addEventListener('change', ({ target }) => {
    if (controls.includes(target)) validateControl(target);
  });
  form.addEventListener('input', ({ target }) => {
    if (controls.includes(target) && target.getAttribute('aria-invalid') === 'true') {
      validateControl(target);
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const invalid = controls.filter((control) => !control.disabled && !validateControl(control));
    if (invalid.length) {
      invalid[0].focus();
      return;
    }
    submitForm(form, button, status);
  });
}

/**
 * Binds an element to a UE property, unless AEM already rendered that instrumentation.
 * @param {Element|undefined} element
 * @param {string} prop Field name in _form.json
 * @param {'text'|'richtext'} type
 */
function instrumentProp(element, prop, type) {
  if (!element || boundProp(element)) return;
  element.dataset.aueProp = prop;
  element.dataset.aueType = type;
  element.dataset.aueLabel = AUE_LABELS[prop];
}

/**
 * Element of a cell that carries a plain-text property: its paragraph, or the cell itself.
 * @param {Element|undefined} cell
 * @returns {Element|undefined}
 */
function textTarget(cell) {
  return cell?.querySelector('p') || cell;
}

/**
 * Marks an element as a UE component, unless AEM already rendered its resource.
 * @param {Element} element
 * @param {object} options
 */
function instrumentComponent(element, {
  resource, type, model, label, filter,
}) {
  if (element.dataset.aueResource) return;
  element.dataset.aueResource = `urn:aemconnection:${window.location.pathname}#${resource}`;
  element.dataset.aueType = type;
  element.dataset.aueModel = model;
  element.dataset.aueLabel = label;
  element.dataset.aueBehavior = 'component';
  if (filter) element.dataset.aueFilter = filter;
}

/**
 * Universal Editor instrumentation (contract §5): the block is a container that only admits
 * form-field items, and every model field keeps its data-aue-prop after decoration.
 * @param {Element} block
 * @param {object} config Config rows and the elements that now render them
 * @param {object[]} fields Item fields as read by readField
 */
function instrumentBlock(block, config, fields) {
  const blockId = uniqueId('form-block');
  instrumentComponent(block, {
    resource: blockId, type: 'container', model: 'form', label: 'Formulario', filter: 'form',
  });

  instrumentProp(config.heading, 'title', 'text');
  instrumentProp(config.button, 'submitLabel', 'text');
  instrumentProp(textTarget(config.action?.firstElementChild), 'action', 'text');

  fields.forEach((field, index) => {
    instrumentComponent(field.row, {
      resource: `${blockId}-field-${index}`,
      type: 'component',
      model: 'form-field',
      label: `Campo ${index + 1}${field.name ? `: ${field.name}` : ''}`,
    });
    ITEM_CELLS.forEach((key) => {
      const cell = field.cells[key];
      if (RICHTEXT_CELLS.includes(key)) instrumentProp(cell, key, 'richtext');
      else instrumentProp(textTarget(cell), key, 'text');
    });
  });
}

/**
 * Decorates the form block.
 *
 * DOM de entrada (matriz EDS, contrato §3b; nombres de campo de _form.json):
 *   div.form
 *     div > div  title        (texto)
 *     div > div  submitLabel  (texto)
 *     div > div  action       (texto: URL mock)
 *     div (form-field) × n
 *       div  fieldName
 *       div  type             (vacío + options → select)
 *       div  label            (placeholder)
 *       div  required         ("true" → required + aria-required)
 *       div  options          (<option value>texto</option>… | lista "valor=texto")
 *       div  help             (richtext: etiqueta del checkbox)
 *
 * @param {Element} block - Root element of the block
 */
export default function decorate(block) {
  const rows = [...block.children];
  const isItem = (row) => row.children.length > 1 || row.dataset.aueModel === 'form-field';
  const itemRows = rows.filter(isItem);
  const configRows = rows.filter((row) => !isItem(row));
  const config = mapConfigRows(configRows);

  // Anchor for sticky-cta and cards--program; only the first form on the page takes it.
  if (!document.getElementById('form')) block.id = 'form';

  const form = document.createElement('form');
  form.method = 'post';
  form.noValidate = true;
  form.dataset.action = readAction(config.action);
  if (form.dataset.action) form.action = form.dataset.action;

  let heading;
  const titleText = cellText(config.title);
  if (config.title && titleText) {
    const cell = config.title.firstElementChild || config.title;
    heading = document.createElement('h2');
    heading.id = uniqueId('form-title');
    const source = cell.querySelector('p, h1, h2, h3, h4, h5, h6');
    if (source) moveInstrumentation(source, heading);
    heading.append(...(source || cell).childNodes);
    if (source) source.hidden = true;
    cell.append(heading);
    form.setAttribute('aria-labelledby', heading.id);
  } else if (config.title) {
    config.title.hidden = true;
  }
  if (config.action) config.action.hidden = true;

  const fields = itemRows.map((row) => {
    form.append(row);
    return readField(row);
  });
  const controls = fields.map(decorateField).filter(Boolean);

  const actions = config.submitLabel || document.createElement('div');
  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'button primary';
  button.textContent = cellText(config.submitLabel);
  const labelSource = config.submitLabel?.querySelector('p');
  if (labelSource) moveInstrumentation(labelSource, button);
  [...actions.children].forEach((cell) => { cell.hidden = true; });
  const status = document.createElement('p');
  status.className = 'form-status';
  status.setAttribute('role', 'status');
  actions.classList.add('form-actions');
  actions.append(button, status);
  form.append(actions);

  block.append(form);
  instrumentBlock(block, { ...config, heading, button }, fields);
  bindEvents(form, controls, button, status);
}
