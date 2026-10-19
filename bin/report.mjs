/**
 * A validation report as one self-contained HTML page: the verdict, the
 * document and schema, and every finding with its line, the business rule's
 * page and the error guide's. It prints cleanly, so "Save as PDF" in the
 * browser's print dialog turns it into a PDF. No scripts but the print button,
 * no external files. report-pdf.js lays the same report out as a PDF.
 *
 * The browser's HTML report button and the command-line client (which ships a copy
 * of this file, clients/cli/bin/report.mjs) use it; the API's report is
 * App\Reports\ValidationReport, a port that ReportParityTest holds to the
 * same output.
 */

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = (n) => (n ?? 0).toLocaleString('en-US');
const plural = (n, one, many) => `${number(n)} ${n === 1 ? one : many}`;

/**
 * The site's mark and wordmark (resources/svg/logo.svg and wordmark.svg; a
 * test keeps them the same) for the report's header: the mark stroked on a
 * 24-unit grid, the wordmark's "xml" and "valid" on a 122 by 25 one.
 */
export const BRAND = {
    green: '#00C850',
    mark: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'm9 11 3 3L22 4'],
    xml: 'M3.16036 24.1662L0 23.6496L5.30071 14.9162V16.2329L0.167215 7.76621L3.24397 7.24957L7.3909 14.4162H6.47124L10.267 7.26627L13.3939 7.76621L8.59485 16.2496V14.9329L13.6949 23.6496L10.6516 24.1662L6.47124 16.8329H7.40765L3.16036 24.1662ZM16 23.9996V7.41624H18.6407L18.9873 8.48291C19.9995 7.97181 20.8467 7.62733 21.5289 7.44957C22.211 7.26067 22.9483 7.16621 23.7405 7.16621C24.5326 7.16621 25.2698 7.29955 25.952 7.56621C26.6341 7.83288 27.2283 8.34957 27.7344 9.11624L26.9917 9.06627C27.993 8.41069 28.9997 7.93293 30.012 7.63288C31.0353 7.32179 32.0035 7.16621 32.9167 7.16621C34.006 7.16621 34.9302 7.37736 35.6894 7.7996C36.4486 8.21069 37.0207 8.84403 37.4059 9.69955C37.802 10.5551 38 11.6385 38 12.9496V23.9996H34.7817V13.3329C34.7817 12.1218 34.6002 11.2496 34.2371 10.7162C33.885 10.1829 33.2523 9.91624 32.3391 9.91624C31.7009 9.91624 31.0132 10.0273 30.2761 10.2496C29.5389 10.4607 28.7522 10.8663 27.916 11.4663L28.081 9.88291C28.246 10.194 28.3726 10.6551 28.4606 11.2663C28.5597 11.8663 28.6091 12.4273 28.6091 12.9496V23.9996H25.3909V13.3329C25.3909 12.1218 25.2093 11.2496 24.8462 10.7162C24.4941 10.1829 23.8669 9.91624 22.9647 9.91624C22.3266 9.91624 21.6334 10.0273 20.8852 10.2496C20.1481 10.4607 19.3613 10.8663 18.5252 11.4663L19.2183 9.36621V23.9996H16ZM41 24V21.3833H44.8117V3.61667H41V1H48.2057V21.3833H52V24H41Z',
    valid: ['M58.2675 23.9972L52.7324 7.71384L55.9093 7.21384L60.6417 21.8138H59.5046L63.9528 7.21384L67.113 7.71384L61.7953 23.9972H58.2675ZM73.7094 24.2639C72.1154 24.2639 70.8055 23.8583 69.7797 23.0472C68.754 22.225 68.2414 21.0083 68.2414 19.3972C68.2414 18.6194 68.4474 17.8305 68.8599 17.0305C69.2837 16.2194 69.9579 15.5416 70.8836 14.9972C71.82 14.4416 73.0459 14.1639 74.5624 14.1639C75.1643 14.1639 75.8107 14.2138 76.5021 14.3139C77.2041 14.4027 77.9286 14.5861 78.6756 14.8639L77.8061 15.7139V13.9972C77.8061 12.9528 77.6776 12.1305 77.4213 11.5305C77.165 10.9305 76.7915 10.5027 76.3014 10.2472C75.822 9.99166 75.2419 9.86387 74.5624 9.86387C73.9492 9.86387 73.2353 9.93608 72.422 10.0805C71.6081 10.225 70.7274 10.4583 69.7797 10.7806L69.2447 8.31389C70.1479 7.96942 71.1062 7.70275 72.1208 7.51389C73.1353 7.3139 74.0942 7.21384 74.9969 7.21384C76.2233 7.21384 77.2876 7.41944 78.1908 7.83053C79.0935 8.23053 79.7848 8.8972 80.2643 9.83053C80.7544 10.7528 81 12.0083 81 13.5972V24.0472H78.3914L77.7895 22.0639L78.408 22.5806C78.1405 22.8361 77.7558 23.0917 77.2544 23.3472C76.7637 23.6027 76.212 23.8194 75.5988 23.9972C74.9856 24.175 74.3558 24.2639 73.7094 24.2639ZM74.2777 21.8972C75.0584 21.8972 75.8161 21.7583 76.5518 21.4805C77.2876 21.1917 77.8617 20.8639 78.2743 20.4972L77.8061 21.8972V15.8138L78.5086 17.1472C77.8617 16.8472 77.271 16.6472 76.7359 16.5472C76.212 16.4472 75.716 16.3972 75.2478 16.3972C74.0551 16.3972 73.1128 16.6472 72.422 17.1472C71.7419 17.6472 71.4016 18.3639 71.4016 19.2972C71.4016 20.1972 71.6526 20.8583 72.1545 21.2805C72.6558 21.6917 73.3638 21.8972 74.2777 21.8972ZM101.017 4.79714C100.415 4.79714 99.9021 4.58602 99.4783 4.1638C99.0546 3.74158 98.8432 3.23047 98.8432 2.63047C98.8432 2.04158 99.0546 1.53603 99.4783 1.1138C99.9021 0.691581 100.415 0.480469 101.017 0.480469C101.619 0.480469 102.126 0.691581 102.539 1.1138C102.962 1.53603 103.174 2.04158 103.174 2.63047C103.174 3.23047 102.962 3.74158 102.539 4.1638C102.126 4.58602 101.619 4.79714 101.017 4.79714ZM113.643 24.1972C111.658 24.1972 110.109 23.5305 108.994 22.1972C107.879 20.8527 107.322 18.686 107.322 15.6971C107.322 12.7527 107.812 10.5972 108.793 9.23048C109.785 7.85273 111.29 7.16382 113.308 7.16382C114.044 7.16382 114.819 7.28051 115.633 7.51384C116.457 7.73608 117.327 8.13608 118.241 8.71384L117.739 9.06387V1H121V23.9972H118.291L117.739 22.3972L118.325 22.7805C117.6 23.2916 116.808 23.6583 115.95 23.8805C115.092 24.0916 114.323 24.1972 113.643 24.1972ZM114.328 21.4305C115.164 21.4305 115.911 21.2971 116.569 21.0305C117.238 20.7527 118.007 20.3027 118.876 19.6805L117.739 21.3972V9.5972L118.943 11.9805C117.873 11.1805 116.942 10.6361 116.15 10.3472C115.359 10.0583 114.635 9.91384 113.977 9.91384C112.773 9.91384 111.904 10.3805 111.368 11.3138C110.845 12.2361 110.582 13.7028 110.582 15.7138C110.582 17.8027 110.872 19.2805 111.452 20.1472C112.043 21.0027 113.002 21.4305 114.328 21.4305Z', 'M84 23.9972V21.3805H87.8113L87.6899 3.61667H84V1H91.084L91.2054 21.3805L99.428 21.3805V10.0304H96.2175V7.4138H102.689V21.3805H106V23.9972L84 23.9972Z'],
};

/** Mark and wordmark side by side as on the site: the mark a third taller, then a gap of half its size. */
const brandSvg = `<svg viewBox="0 0 170 32" role="img" aria-label="xmlvalid"><g transform="scale(1.3333)" fill="none" stroke="${BRAND.green}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${BRAND.mark.map((d) => `<path d="${d}"/>`).join('')}</g><g transform="translate(48 0)"><path fill="#171717" d="${BRAND.xml}"/>${BRAND.valid.map((d) => `<path fill="${BRAND.green}" d="${d}"/>`).join('')}</g></svg>`;

/** "1,500 errors · 1 warning", leaving out a count of none. */
export function countsText(errors, warnings) {
    return [errors ? plural(errors, 'error', 'errors') : '', warnings ? plural(warnings, 'warning', 'warnings') : ''].filter(Boolean).join(' · ');
}

const SEVERITY = { warning: 0, error: 1, fatal: 2 };

/**
 * The note that takes the business rules' place when they did not run
 * (schematron/rules.js skipped()): shown apart from the findings, as it
 * says why there are none from the rules.
 */
export function isRulesNote(d) {
    return d.type === 'schematron' && !d.rule && String(d.message ?? '').startsWith('Business rules were not checked');
}

/**
 * Findings grouped by the rule or check that raised them, most often first:
 * { source, ruleUrl, level, count }. Null when no two findings share one,
 * as the list says it all then.
 */
export function findingGroups(diagnostics) {
    const groups = new Map();
    for (const d of diagnostics) {
        const source = findingSource(d) || d.message;
        const level = String(d.level ?? 'ERROR').toLowerCase();
        const group = groups.get(source) ?? { source, ruleUrl: d.ruleUrl ?? null, level, count: 0 };
        if ((SEVERITY[level] ?? 1) > (SEVERITY[group.level] ?? 1)) group.level = level;
        group.count++;
        groups.set(source, group);
    }
    return groups.size < diagnostics.length ? [...groups.values()].sort((a, b) => b.count - a.count) : null;
}

/** What a verdict says, as the validator words it. */
export function verdictText(verdict, errors, warnings) {
    return {
        valid: 'Document is valid',
        warnings: `Document is valid, with ${plural(warnings, 'warning', 'warnings')}`,
        invalid: `Document is invalid: ${plural(errors + warnings, 'issue', 'issues')}`,
        schema: 'The schema could not be loaded',
        input: 'The document could not be read',
        failed: 'The document could not be checked',
    }[verdict] ?? verdict;
}

/** Where a finding comes from: the business rule, the PDF layer or the parser. */
export function findingSource(d) {
    if (d.type === 'schematron') return d.rule ? `Business rule ${d.rule}` : 'Business rules';
    if (d.type === 'pdf') return `PDF/A-3 layer ${d.rule}`;
    return d.type ? `${d.type}${d.code ? ` · code ${d.code}` : ''}` : '';
}

function findingRows(diagnostics) {
    return diagnostics
        .map((d) => {
            const where = d.ruleUrl ? `<a href="${escape(d.ruleUrl)}">${escape(findingSource(d))}</a>` : escape(findingSource(d));
            const level = String(d.level ?? 'ERROR').toLowerCase();
            return `<tr>
<td class="line">${d.line > 0 ? `${number(d.line)}${d.column > 0 ? `:${d.column}` : ''}` : 'document'}</td>
<td><span class="chip ${level === 'warning' ? 'warn' : 'err'}">${escape(level)}</span></td>
<td>${escape(d.message)}${d.english ? `<div class="en">In English: ${escape(d.english)}</div>` : ''}${d.path ? `<div class="path">${escape(d.path)}</div>` : ''}<div class="meta">${where}${d.file ? ` · ${escape(d.file)}` : ''}${d.guideUrl ? ` · <a href="${escape(d.guideUrl)}">what does this mean?</a>` : ''}</div></td>
</tr>`;
        })
        .join('\n');
}

function findingsTable(diagnostics) {
    if (!diagnostics.length) return '';
    return `<table><thead><tr><th>Line</th><th>Level</th><th>Finding</th></tr></thead><tbody>
${findingRows(diagnostics)}
</tbody></table>`;
}

function groupsTable(groups) {
    const rows = groups.map((g) => `<tr>
<td class="line">${number(g.count)}</td>
<td><span class="chip ${g.level === 'warning' ? 'warn' : 'err'}">${escape(g.level)}</span></td>
<td>${g.ruleUrl ? `<a href="${escape(g.ruleUrl)}">${escape(g.source)}</a>` : escape(g.source)}</td>
</tr>`);
    return `<h3>By rule or check</h3><table class="groups"><thead><tr><th>Count</th><th>Level</th><th>Rule or check</th></tr></thead><tbody>
${rows.join('\n')}
</tbody></table>
<h3>All findings</h3>`;
}

const tone = (verdict) => (verdict === 'valid' ? 'ok' : verdict === 'warnings' ? 'warn' : 'err');

/**
 * @param {object} report
 * @param {string} report.title The page title, such as the document's name
 * @param {string} report.generated When the documents were checked (ISO 8601)
 * @param {string} report.origin The site that checked them (https://xmlvalid.com)
 * @param {'browser'|'api'} [report.via] Where they were checked
 * @param {?string} report.schema The schema or catalog entry, null for well-formedness only
 * @param {?string} [report.rules] The rule sets with their releases, and rules of the user's own, that ran after the schema
 * @param {?string} [report.engine] What checked the documents ("libxml2 2.13.9 (WebAssembly) · SaxonJS 2.7")
 * @param {{ name: string, verdict: ?string, errors: number, warnings: number, size?: number, sha256?: string, note?: string,
 *           schemaErrors?: object[], diagnostics: object[] }[]} report.documents Findings carry `ruleUrl` and `guideUrl`, absolute, `english` for a rule written in another language and `path` for where a business rule fired
 * @param {?{ total: number, passed: number, failed: number, skipped: number }} [report.summary] A batch's counts
 * @param {?string} [report.note] A line above the footer, such as when a shared link expires
 */
export function reportHtml({ title, generated, origin, via = 'browser', schema, rules = null, engine = null, documents, summary = null, note = null }) {
    const date = new Date(generated).toUTCString().replace('GMT', 'UTC');
    const host = new URL(origin).host;
    const ruled = documents.some((doc) => [...(doc.schemaErrors ?? []), ...doc.diagnostics].some((d) => d.ruleUrl));

    const single = documents.length === 1 && !summary;
    const counts = single ? countsText(documents[0].errors, documents[0].warnings) : '';
    const head = single
        ? `<div class="verdict ${tone(documents[0].verdict)}">${escape(verdictText(documents[0].verdict, documents[0].errors, documents[0].warnings))}</div>${counts ? `\n<p class="counts">${counts}</p>` : ''}`
        : `<div class="verdict ${summary.failed ? 'err' : 'ok'}">${summary.failed ? `${number(summary.failed)} of ${plural(summary.total, 'document', 'documents')} failed` : `All ${plural(summary.passed, 'document', 'documents')} checked are valid`}</div>
<p class="counts">${number(summary.passed)} passed · ${number(summary.failed)} failed${summary.skipped ? ` · ${number(summary.skipped)} not checked` : ''}</p>`;

    const facts = [
        ['Schema', schema ?? 'Well-formedness only'],
        ...(rules ? [['Rules', rules]] : []),
        ...(single && documents[0].size != null ? [['Size', `${number(documents[0].size)} bytes`]] : []),
        ...(single && documents[0].sha256 ? [['SHA-256', documents[0].sha256]] : []),
        ...(engine ? [['Engine', engine]] : []),
        ['Checked', date],
    ];

    const sections = documents
        .map((doc) => {
            const issues = (doc.schemaErrors?.length ?? 0) + doc.diagnostics.length;
            const shown = doc.errors + doc.warnings > doc.diagnostics.length;
            const notes = doc.diagnostics.filter(isRulesNote);
            const findings = doc.diagnostics.filter((d) => !isRulesNote(d));
            const groups = findingGroups(findings);
            const heading = single
                ? (issues ? '' : '<p>No errors or warnings.</p>')
                : `<h2><span class="dot ${doc.verdict ? tone(doc.verdict) : 'idle'}"></span>${escape(doc.name)}</h2>
<p class="meta">${escape(doc.verdict ? verdictText(doc.verdict, doc.errors, doc.warnings) : 'Not checked')}${doc.note ? ` · ${escape(doc.note)}` : ''}</p>${doc.sha256 ? `\n<p class="meta">SHA-256 ${escape(doc.sha256)}</p>` : ''}`;
            return `<section>
${heading}
${doc.schemaErrors?.length ? `<h3>Schema problems</h3>${findingsTable(doc.schemaErrors)}` : ''}
${groups ? groupsTable(groups) : ''}${findingsTable(findings)}${notes.map((d) => `\n<p class="aside">${escape(d.message)}</p>`).join('')}
${shown && issues ? `<p class="meta">The first ${number(doc.diagnostics.length)} of ${number(doc.errors + doc.warnings)} findings are listed.</p>` : ''}
</section>`;
        })
        .join('\n');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · validation report</title>
<style>
:root { color-scheme: light; --ok: #15803d; --warn: #b45309; --err: #b91c1c; --line: #e5e5e5; --muted: #525252; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #171717; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 48px; }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); padding-bottom: 16px; margin-bottom: 20px; }
header h1 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
header .tools { display: flex; gap: 16px; align-items: center; }
header .brand { display: block; line-height: 0; }
header .brand svg { height: 22px; width: auto; }
.verdict { font-size: 18px; font-weight: 600; padding: 12px 16px; border-radius: 8px; border: 1px solid; }
.verdict.ok { color: var(--ok); border-color: #bbf7d0; background: #f0fdf4; }
.verdict.warn { color: var(--warn); border-color: #fde68a; background: #fffbeb; }
.verdict.err { color: var(--err); border-color: #fecaca; background: #fef2f2; }
.counts { margin: 8px 0 0; color: var(--muted); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 16px 0 8px; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
section { margin-top: 28px; break-inside: auto; }
h2 { display: flex; gap: 8px; align-items: center; font-size: 15px; margin: 0 0 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
h3 { font-size: 13px; margin: 12px 0 4px; color: var(--muted); }
.meta { color: var(--muted); font-size: 12px; margin: 2px 0 0; overflow-wrap: anywhere; }
.en { font-size: 13px; margin: 2px 0 0; overflow-wrap: anywhere; }
.path { color: var(--muted); font-size: 12px; margin: 2px 0 0; overflow-wrap: anywhere; }
.aside { margin: 12px 0 0; padding: 8px 12px; border-left: 3px solid #fde68a; background: #fffbeb; color: var(--muted); font-size: 13px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border-bottom: 1px solid var(--line); padding: 6px 8px; }
th:nth-child(1) { width: 90px; } th:nth-child(2) { width: 80px; }
td { vertical-align: top; border-bottom: 1px solid var(--line); padding: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
tr { break-inside: avoid; }
td.line { white-space: nowrap; color: var(--muted); }
table.groups td { padding-top: 4px; padding-bottom: 4px; }
.chip { display: inline-block; border-radius: 4px; padding: 0 6px; font-size: 11px; }
.chip.err { color: var(--err); background: #fef2f2; }
.chip.warn { color: var(--warn); background: #fffbeb; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; background: #a3a3a3; }
.dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); } .dot.err { background: var(--err); }
a { color: #4338ca; }
.note { margin-top: 16px; }
footer { margin-top: 36px; border-top: 1px solid var(--line); padding-top: 12px; color: var(--muted); font-size: 12px; }
.print { font: inherit; font-size: 13px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: #fff; cursor: pointer; }
@media (max-width: 560px) { th:nth-child(1) { width: 64px; } th:nth-child(2) { width: 64px; } td { padding: 6px 4px; } }
@media print { main { padding: 0; max-width: none; } .print { display: none; } a { color: inherit; text-decoration: none; } }
</style>
</head>
<body>
<main>
<header>
<h1>${escape(title)}</h1>
<span class="tools"><button class="print" type="button" onclick="print()">Save as PDF</button> <a class="brand" href="${escape(origin)}" title="${escape(host)}">${brandSvg}</a></span>
</header>
${head}
<dl>${facts.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>
${sections}
${note ? `<p class="meta note">${escape(note)}</p>\n` : ''}<footer>${via === 'api' ? `Validated with the <a href="${escape(origin)}">${escape(host)}</a> API.` : `Validated in the browser at <a href="${escape(origin)}">${escape(host)}</a>.`}${ruled ? ' Rule ids link to what each rule checks and how to fix it.' : ''}</footer>
</main>
</body>
</html>
`;
}

const VERDICTS = ['valid', 'warnings', 'invalid', 'schema', 'input', 'failed'];

/** A document's findings from an API result, in document order. */
function apiFindings(result) {
    return [...(result.errors ?? []), ...(result.warnings ?? [])]
        .map((d, i) => ({ d, i }))
        .sort((a, b) => a.d.line - b.d.line || a.i - b.i)
        .map(({ d }) => ({ type: d.type, level: d.level, line: d.line, column: d.column, message: d.message, rule: d.rule, path: d.path ?? null, english: d.message_en ?? null, ruleUrl: d.rule_url ?? null, guideUrl: d.help_url ?? null }));
}

function apiDocument(name, validation) {
    const result = validation.result;
    if (!result) {
        return { name, verdict: 'failed', errors: 0, warnings: 0, note: validation.error ?? validation.status, diagnostics: [] };
    }
    const verdict = VERDICTS.includes(result.outcome) ? result.outcome : null;
    return {
        name,
        verdict,
        errors: result.errors_total ?? 0,
        warnings: result.warnings_total ?? 0,
        size: result.bytes,
        ...(result.sha256 ? { sha256: result.sha256 } : {}),
        ...(verdict === null ? { note: result.note ?? 'not checked' } : {}),
        diagnostics: apiFindings(result),
    };
}

/** "Peppol BIS Billing 3.0 rules 3.0.21": a rule set's name with its release, once. */
function ruleSetLabel(set) {
    return set.name.includes(set.version) ? set.name : `${set.name} ${set.version}`;
}

/**
 * The report of API validations (GET /api/v1/validations/{id}), each named by
 * its file or URL. An archive lists its documents as "orders.zip!a.xml".
 *
 * @param {{ name: string, validation: object }[]} entries
 * @param {{ origin: string, generated: string }} options
 */
export function fromApi(entries, { origin, generated }) {
    const documents = entries.flatMap(({ name, validation }) =>
        validation.result?.items ? validation.result.items.map((item) => apiDocument(`${name}!${item.name}`, { result: item })) : [apiDocument(name, validation)],
    );
    const batch = entries.length > 1 || entries.some(({ validation }) => validation.result?.items);
    const passed = documents.filter((d) => d.verdict === 'valid' || d.verdict === 'warnings').length;
    const skipped = documents.filter((d) => d.verdict === null).length;
    const schema = entries.map(({ validation }) => validation.schema).find(Boolean) ?? null;
    // The catalog rule sets with their releases (an archive's items carry their own), then rules of the caller's own.
    const rules = [];
    for (const { validation } of entries) {
        const sets = [...(validation.rule_sets ?? []), ...(validation.result?.items ?? []).flatMap((item) => item.rule_sets ?? [])];
        for (const label of [...sets.map(ruleSetLabel), ...(validation.rules?.name ? [validation.rules.name] : [])]) {
            if (!rules.includes(label)) rules.push(label);
        }
    }
    // What checked them: one engine on the server, SaxonJS when the rules ran on any.
    const engines = entries.map(({ validation }) => validation.result?.engine).filter((e) => e?.libxml2);
    const saxon = engines.map((e) => e.saxonjs).find(Boolean);
    const engine = engines.length ? `libxml2 ${engines[0].libxml2} (native)${saxon ? ` · SaxonJS ${saxon}` : ''}` : null;

    return {
        title: batch ? plural(documents.length, 'document', 'documents') : documents[0]?.name ?? 'Validation',
        generated,
        origin,
        via: 'api',
        schema: schema ? (schema.kind === 'doctype' ? 'The document\'s own DOCTYPE' : `${schema.name ?? schema.catalog ?? schema.saved} · ${String(schema.kind).toUpperCase()}`) : null,
        rules: rules.length ? rules.join(' · ') : null,
        engine,
        documents,
        summary: batch ? { total: documents.length, passed, failed: documents.length - passed - skipped, skipped } : null,
    };
}
