/**
 * Turns WebDriverAgent's XCUITest page source into a short, indexed list of
 * on-screen elements that a decision model can choose from *by index*.
 *
 * The model never sees or produces coordinates: it returns an index into the
 * list built here, and our code maps index → rect → centre → tap(x, y). The
 * list is pruned hard on purpose — Jev has a 32K context and documented
 * accuracy loss as irrelevant state grows, so smaller is better, not just
 * cheaper. Target: the serialised list stays under ~4000 tokens.
 */

export interface IndexedElement {
    /** Stable within one call; the only thing a model is allowed to answer with. */
    index: number;
    /** XCUIElementType with the prefix removed, e.g. "Button". */
    role: string;
    label?: string;
    value?: string;
    /** Points, origin top-left. */
    rect: { x: number; y: number; w: number; h: number };
}

export interface IndexElementsOptions {
    screen: { width: number; height: number };
    /** Hard cap on the number of elements returned (default 120). */
    max?: number;
}

export interface IndexedElementReport {
    elements: IndexedElement[];
    /** Elements that survived visibility/area pruning before the cap. */
    candidates: number;
    /** Raw XCUIElementType nodes in the source. */
    total: number;
    /** Rough token count of `serializeElements(elements)`. */
    tokenEstimate: number;
}

export const DEFAULT_MAX_ELEMENTS = 120;
/** iOS status bar band; the clock and battery glyphs are never tap targets. */
const STATUS_BAR_POINTS = 54;
const LABEL_MAX = 60;
const VALUE_MAX = 40;

/** Pure layout wrappers: kept only when they carry a label or value of their own. */
const CONTAINER_ROLES = new Set([
    'Application', 'Window', 'Other', 'Group', 'LayoutArea', 'LayoutItem', 'Any', 'Cell',
    'ScrollView', 'CollectionView', 'Table', 'NavigationBar', 'TabBar', 'Toolbar', 'WebView',
    'StatusBar', 'Sheet', 'Popover', 'Alert', 'Dialog', 'Outline', 'OutlineRow',
]);

/** Roles a finger can meaningfully act on; win ties against static text with the same label. */
const INTERACTIVE_ROLES = new Set([
    'Button', 'TextField', 'SecureTextField', 'SearchField', 'Switch', 'Slider', 'Link', 'Tab',
    'SegmentedControl', 'Stepper', 'PageIndicator', 'Picker', 'PickerWheel', 'MenuItem', 'MenuButton',
    'PopUpButton', 'CheckBox', 'RadioButton', 'Toggle', 'Key', 'Cell', 'Image', 'TextView',
]);

const ELEMENT_PATTERN = /<XCUIElementType(\w+)\b([^>]*?)\/?>/g;
const ATTRIBUTE_PATTERN = /(\w+)="([^"]*)"/g;

function decodeEntities(value: string): string {
    return value
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
        .replace(/&amp;/g, '&');
}

function parseAttributes(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const match of raw.matchAll(ATTRIBUTE_PATTERN)) {
        const [, key, value] = match;
        if (key && value !== undefined) out[key] = decodeEntities(value);
    }
    return out;
}

function clip(value: string, max: number): string {
    const single = value.replace(/\s+/g, ' ').trim();
    return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

interface Candidate {
    role: string;
    label?: string;
    value?: string;
    rect: IndexedElement['rect'];
    centre: { x: number; y: number };
    interactive: boolean;
}

/**
 * Prune the raw hierarchy to visible, hittable, meaningful elements, cap the
 * list, and number it. Selection under the cap is nearest-to-screen-centre
 * first; the surviving elements are then returned in reading order
 * (top → bottom, left → right) so indices follow the layout.
 */
export function indexElementsReport(xml: string, options: IndexElementsOptions): IndexedElementReport {
    const max = options.max ?? DEFAULT_MAX_ELEMENTS;
    const { width, height } = options.screen;
    const candidates: Candidate[] = [];
    let total = 0;

    for (const match of xml.matchAll(ELEMENT_PATTERN)) {
        total += 1;
        const role = match[1] ?? 'Other';
        if (role === 'Application' || role === 'Window') continue;
        const attributes = parseAttributes(match[2] ?? '');
        if (attributes.visible === 'false') continue;
        // WDA only emits `hittable` when a session enables includeHittableInPageSource;
        // honour it when present and fall back to visible + enabled otherwise.
        if (attributes.hittable === 'false') continue;
        if (attributes.enabled === 'false') continue;

        const x = Number(attributes.x);
        const y = Number(attributes.y);
        const w = Number(attributes.width);
        const h = Number(attributes.height);
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
        if (x + w <= 0 || y + h <= 0 || x >= width || y >= height) continue;
        if (y + h <= STATUS_BAR_POINTS) continue;

        const label = clip(attributes.label || attributes.name || '', LABEL_MAX) || undefined;
        const rawValue = attributes.value ? clip(attributes.value, VALUE_MAX) : '';
        const value = rawValue && rawValue !== label ? rawValue : undefined;
        if (CONTAINER_ROLES.has(role) && !label && !value) continue;
        if (!INTERACTIVE_ROLES.has(role) && !label && !value) continue;
        // A full-screen wrapper is never the thing to tap; the model sees its children.
        if (w >= width * 0.95 && h >= height * 0.9 && !INTERACTIVE_ROLES.has(role)) continue;

        candidates.push({
            role, label, value,
            rect: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) },
            centre: { x: x + w / 2, y: y + h / 2 },
            interactive: INTERACTIVE_ROLES.has(role),
        });
    }

    // Buttons wrap a StaticText with the same label at (nearly) the same spot;
    // keep the interactive one so the index we hand back is the tappable node.
    const deduped: Candidate[] = [];
    const seen = new Set<string>();
    for (const candidate of [...candidates].sort((a, b) => Number(b.interactive) - Number(a.interactive))) {
        const key = `${candidate.label ?? ''}|${candidate.value ?? ''}|${Math.round(candidate.centre.x / 8)}|${Math.round(candidate.centre.y / 8)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(candidate);
    }

    const screenCentre = { x: width / 2, y: height / 2 };
    const distance = (candidate: Candidate) => Math.hypot(candidate.centre.x - screenCentre.x, candidate.centre.y - screenCentre.y);
    const kept = deduped.length > max
        ? [...deduped].sort((a, b) => distance(a) - distance(b)).slice(0, max)
        : deduped;
    kept.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

    const elements = kept.map((candidate, index): IndexedElement => ({
        index,
        role: candidate.role,
        ...(candidate.label ? { label: candidate.label } : {}),
        ...(candidate.value ? { value: candidate.value } : {}),
        rect: candidate.rect,
    }));
    return { elements, candidates: deduped.length, total, tokenEstimate: estimateTokens(serializeElements(elements)) };
}

export function indexElements(xml: string, options: IndexElementsOptions): IndexedElement[] {
    return indexElementsReport(xml, options).elements;
}

/** What a model actually sees per element. Rects go as `[x, y, w, h]`. */
export interface CompactElement {
    i: number;
    role: string;
    label?: string;
    value?: string;
    rect: [number, number, number, number];
}

/**
 * The model-facing shape: rough geometry ("bottom tab bar") without our field
 * names. This is the state sent to the decision backend.
 */
export function compactElements(elements: readonly IndexedElement[]): CompactElement[] {
    return elements.map((element) => ({
        i: element.index,
        role: element.role,
        ...(element.label ? { label: element.label } : {}),
        ...(element.value ? { value: element.value } : {}),
        rect: [element.rect.x, element.rect.y, element.rect.w, element.rect.h],
    }));
}

export function serializeElements(elements: readonly IndexedElement[]): string {
    return `[${compactElements(elements).map((element) => JSON.stringify(element)).join(',\n')}]`;
}

/** ~4 characters per token is close enough to tune the pruner against. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** The only place an element becomes a coordinate. */
export function elementCentre(element: IndexedElement): { x: number; y: number } {
    return {
        x: Math.round(element.rect.x + element.rect.w / 2),
        y: Math.round(element.rect.y + element.rect.h / 2),
    };
}
