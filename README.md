# @xmlvalid/cli

Validate XML files and e-invoices from your terminal, a Git hook or CI with the
[xmlvalid.com](https://xmlvalid.com) API: XSD 1.0, DTD and RelaxNG schemas, your own
Schematron rules, and the business rules of EN 16931, Peppol BIS and PINT, XRechnung,
Factur-X / ZUGFeRD and national e-invoicing formats from the
[schema catalog](https://xmlvalid.com/schemas). No dependencies; Node.js 20 or newer.

```sh
npm install -g @xmlvalid/cli
export XMLVALID_API_KEY=xv_…        # https://xmlvalid.com/dashboard/api

xmlvalid validate invoices/*.xml --schema ubl-2.1-invoice
xmlvalid validate "out/**/*.xml" --schema auto          # Peppol, XRechnung, Factur-X…
xmlvalid validate "feeds/**/*.atom" --schema atom-1.0 --format github
xmlvalid validate order.xml --schema-file schemas/order.xsd
xmlvalid validate --url https://example.com/sitemap.xml --schema sitemap-0.9
xmlvalid schemas     # catalog slugs and your saved schemas (@orders-v3)
xmlvalid usage
```

Each document counts as one API validation (Free: 100 a month, Pro: 10,000).
A schema that spans several files can be saved once in the dashboard and used as
`--schema @orders-v3`.

A `.zip` is validated document by document on the server (its XML files, against the
schema) and an `.epub` file by file against its own schemas; the documents are listed
under the archive as `orders.zip!orders/order-1.xml`, and each one checked counts as
an API validation. A Factur-X, ZUGFeRD or XRechnung `.pdf` has its XML invoice
validated (with the profile it names when no `--schema` is given), and problems with
the PDF around it are listed as `[PDF-…]` findings.

## Options

| Option | |
|---|---|
| `-s, --schema <name>` | a catalog slug (`atom-1.0`), a saved schema (`@orders-v3`), or `auto` for the profile each e-invoice names (Peppol, XRechnung, French, KSeF…) |
| `--schema-file <path>` | one XSD, DTD or RelaxNG file sent with each document |
| `--rules <path>` | your own Schematron (`.sch`) file, run after the schema check; findings show their rule id |
| `--rules-version <set@version>` | fail (exit 2) when a catalog profile's business rules are at another release, such as `peppol-bis-3-ubl@3.0.21`; repeat for several. The rule sets and releases used are printed under the summary |
| `--doctype` | validate against each document's own DOCTYPE |
| `--url <address>` | a document at a public URL (repeatable) |
| `-f, --format <format>` | `text`, `json` or `github` (annotations and a job summary) |
| `--fail-on-warnings` | treat warnings as failures |
| `--report <file.html>` | also write an HTML report of every document, with links to each rule (open it and print it to save a PDF) |
| `--share` | also make a public link to that report, open for 30 days (Pro); printed at the end and added to the GitHub job summary |
| `--fix` | fix what the validator's "Fix and check again" fixes (date and amount formats, code case, specification identifiers, element order, scheme names, VAT prefixes…) and write `<name>.fixed.xml` beside each file, with the changes and the fixed file's own verdict printed under it (Pro, UBL and CII invoices checked against a catalog profile). The exit code stays that of the files as sent |
| `--fix-value <key=value>` | a value a fix asks for (printed as "needs --fix-value …"), such as `buyer-reference=04011000-12346-97`; repeatable |
| `-j, --concurrency <n>` | documents validated at once, default 4 |
| `--max-errors <n>` | errors printed per document, default 20 |
| `--api-key`, `--api-url` | default to `XMLVALID_API_KEY`, `XMLVALID_API_URL` |

Globs support `*`, `**`, `?` and `{a,b}`; quote them so the shell leaves them alone.

Exit codes: `0` all valid, `1` a document is invalid, `2` a usage, schema or quota
problem, `3` a network or server error.

## Writing an e-invoice

`xmlvalid invoice <invoice.json>` sends the invoice's fields to `POST /invoices`
(fields at [xmlvalid.com/docs/api#invoices](https://xmlvalid.com/docs/api#invoices)),
writes the XRechnung, Peppol BIS, ZUGFeRD / Factur-X or France CTC document it gets
back as `<number>.xml` and prints its check against the profile's official rules:

```sh
xmlvalid invoice invoice.json                         # RE-2026-0042.xml
xmlvalid invoice invoice.json --pdf -o out/invoice.pdf  # ZUGFeRD PDF with the XML inside
cat invoice.json | xmlvalid invoice -
```

The JSON is the invoice itself or `{ "invoice": … }`. `--pdf` writes a PDF/A-3 with
the XML inside (profiles `zugferd`, `xrechnung` and `france`); `--rules-version`,
`--fail-on-warnings`, `--format` and `--max-errors` work as for `validate`. Exit `0`
when the invoice passes, `1` when it breaks a rule (it is still written), `2` when it
could not be written. One invoice counts as one API validation.

## GitHub Actions

```yaml
- uses: xmlvalid/validate-action@v1
  with:
    files: "feeds/**/*.xml"
    schema: atom-1.0
    api-key: ${{ secrets.XMLVALID_API_KEY }}
```

## pre-commit

```yaml
repos:
  - repo: https://github.com/xmlvalid/cli
    rev: v1.0.0
    hooks:
      - id: xmlvalid
        args: [--schema, atom-1.0]
```

More: https://xmlvalid.com/docs/ci
