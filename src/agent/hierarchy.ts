/**
 * Compacts the XCUITest XML view hierarchy that WebDriverAgent returns from
 * `/source` into a short, model-friendly list of on-screen elements.
 *
 * A raw iOS hierarchy is tens of thousands of characters of nested
 * `<XCUIElementTypeOther>` wrappers. The VLM only needs the interactive and
 * labelled leaves with their centre points, so we strip everything else.
 */

export interface UiElement {
    type: string;
    label: string;
    value?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    enabled: boolean;
    interactive: boolean;
}

export interface CompactHierarchy {
    elements: UiElement[];
    text: string;
    truncated: boolean;
    total: number;
    /** Name of the foreground application, when WDA reports one. */
    app: string | null;
}

const APP_PATTERN = /<XCUIElementTypeApplication\b([^>]*)>/;

export function foregroundApp(xml: string): string | null {
    const match = APP_PATTERN.exec(xml);
    if (!match) return null;
    const attributes = parseAttributes(match[1] ?? '');
    return clip(attributes.label || attributes.name || '') || null;
}

const INTERACTIVE_TYPES = new Set([
    'Button', 'TextField', 'SecureTextField', 'SearchField', 'Switch', 'Slider', 'Link',
    'Cell', 'Tab', 'TabBar', 'SegmentedControl', 'Stepper', 'PageIndicator', 'Picker',
    'PickerWheel', 'MenuItem', 'MenuButton', 'PopUpButton', 'CheckBox', 'RadioButton',
    'Toggle', 'Key', 'Keyboard', 'Image', 'TextView', 'CollectionView', 'Table', 'ScrollView',
]);

const CONTAINER_ONLY = new Set(['Application', 'Window', 'Other', 'Group', 'LayoutArea', 'LayoutItem', 'Any']);

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

function clip(value: string, max = 60): string {
    const single = value.replace(/\s+/g, ' ').trim();
    return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export function parseHierarchy(xml: string, screen?: { width: number; height: number }): UiElement[] {
    const elements: UiElement[] = [];
    const seen = new Set<string>();
    for (const match of xml.matchAll(ELEMENT_PATTERN)) {
        const type = match[1] ?? 'Other';
        if (type === 'Application' || type === 'Window') continue;
        const attributes = parseAttributes(match[2] ?? '');
        if (attributes.visible === 'false') continue;
        const x = Number(attributes.x);
        const y = Number(attributes.y);
        const width = Number(attributes.width);
        const height = Number(attributes.height);
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
        if (screen && (x + width <= 0 || y + height <= 0 || x >= screen.width || y >= screen.height)) continue;

        const label = clip(attributes.label || attributes.name || '');
        const value = attributes.value && attributes.value !== label ? clip(attributes.value, 40) : undefined;
        const interactive = INTERACTIVE_TYPES.has(type);
        if (CONTAINER_ONLY.has(type) && !label) continue;
        if (!interactive && !label && !value) continue;
        // Full-screen scroll containers carry no signal; the model sees their children.
        if (['ScrollView', 'CollectionView', 'Table'].includes(type) && !label) continue;
        if (screen && width >= screen.width * 0.95 && height >= screen.height * 0.9 && !label) continue;

        const centerX = Math.round(x + width / 2);
        const centerY = Math.round(y + height / 2);
        const key = `${type}|${label}|${value ?? ''}|${centerX}|${centerY}`;
        if (seen.has(key)) continue;
        seen.add(key);
        elements.push({
            type, label, value, x, y, width, height, centerX, centerY,
            enabled: attributes.enabled !== 'false', interactive,
        });
    }
    return elements;
}

function describe(element: UiElement): string {
    const parts = [`${element.type}`];
    if (element.label) parts.push(`"${element.label}"`);
    if (element.value) parts.push(`value="${element.value}"`);
    parts.push(`@(${element.centerX},${element.centerY})`);
    parts.push(`${Math.round(element.width)}x${Math.round(element.height)}`);
    if (!element.enabled) parts.push('disabled');
    return parts.join(' ');
}

export function compactHierarchy(
    xml: string,
    options: { screen?: { width: number; height: number }; maxElements?: number; maxChars?: number } = {},
): CompactHierarchy {
    const maxElements = options.maxElements ?? 120;
    const maxChars = options.maxChars ?? 7_000;
    const all = parseHierarchy(xml, options.screen);
    // Interactive controls first so they survive truncation; keep visual order within each group.
    const ordered = [
        ...all.filter((element) => element.interactive),
        ...all.filter((element) => !element.interactive),
    ].sort((a, b) => (a.interactive === b.interactive ? a.centerY - b.centerY || a.centerX - b.centerX : a.interactive ? -1 : 1));
    const lines: string[] = [];
    let chars = 0;
    let truncated = false;
    for (const element of ordered) {
        if (lines.length >= maxElements) { truncated = true; break; }
        const line = describe(element);
        if (chars + line.length + 1 > maxChars) { truncated = true; break; }
        lines.push(line);
        chars += line.length + 1;
    }
    const kept = new Set(lines);
    const elements = ordered.filter((element) => kept.has(describe(element)));
    const app = foregroundApp(xml);
    const body = lines.length ? lines.join('\n') : '(no labelled or interactive elements reported)';
    return {
        elements,
        text: app ? `Foreground app: ${app}\n${body}` : body,
        truncated,
        total: all.length,
        app,
    };
}
