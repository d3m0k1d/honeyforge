export type ExportFormat = "csv" | "tsv" | "json" | "txt" | "xml" | "xls";

export interface ExportColumn<T> {
  key: string;
  label: string;
  value: (row: T) => string | number;
}

export const EXPORT_FORMATS: {
  key: ExportFormat;
  label: string;
  icon: string;
  mime: string;
}[] = [
  {
    key: "csv",
    label: "CSV · запятая",
    icon: "i-lucide-file",
    mime: "text/csv;charset=utf-8",
  },
  {
    key: "tsv",
    label: "TSV · табуляция",
    icon: "i-lucide-table-2",
    mime: "text/tab-separated-values;charset=utf-8",
  },
  {
    key: "txt",
    label: "TXT · текст",
    icon: "i-lucide-file-text",
    mime: "text/plain;charset=utf-8",
  },
  {
    key: "json",
    label: "JSON",
    icon: "i-lucide-file-json",
    mime: "application/json;charset=utf-8",
  },
  {
    key: "xml",
    label: "XML",
    icon: "i-lucide-file-code",
    mime: "application/xml;charset=utf-8",
  },
  {
    key: "xls",
    label: "Excel (XLS)",
    icon: "i-lucide-file-spreadsheet",
    mime: "application/vnd.ms-excel;charset=utf-8",
  },
];

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeCsv(value: string, delimiter: string) {
  const needsQuotes =
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes(delimiter);

  const escaped = value.replaceAll('"', '""');

  return needsQuotes ? `"${escaped}"` : escaped;
}

function rowsToText<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  delimiter: string,
  quote: boolean,
) {
  const header = columns
    .map((column) =>
      quote
        ? escapeCsv(column.label, delimiter)
        : column.label,
    )
    .join(delimiter);

  const body = rows.map((row) =>
    columns
      .map((column) => {
        const value = String(column.value(row) ?? "");

        return quote ? escapeCsv(value, delimiter) : value.replaceAll("\t", " ");
      })
      .join(delimiter),
  );

  return [header, ...body].join("\r\n");
}

function rowsToTextAligned<T>(rows: T[], columns: ExportColumn<T>[]) {
  const matrix = rows.map((row) =>
    columns.map((column) => String(column.value(row) ?? "")),
  );

  const widths = columns.map((column, index) =>
    Math.max(
      column.label.length,
      ...matrix.map((line) => line[index]?.length ?? 0),
    ),
  );

  const header = columns
    .map((column, index) => column.label.padEnd(widths[index]!, " "))
    .join("  ");

  const separator = widths.map((width) => "─".repeat(width)).join("──");

  const body = matrix.map((line) =>
    line.map((value, index) => value.padEnd(widths[index]!, " ")).join("  "),
  );

  return [header, separator, ...body].join("\n");
}

function rowsToJson<T>(rows: T[], columns: ExportColumn<T>[]) {
  const data = rows.map((row) =>
    columns.reduce<Record<string, string | number>>((acc, column) => {
      acc[column.key] = column.value(row);

      return acc;
    }, {}),
  );

  return JSON.stringify(data, null, 2);
}

function rowsToXml<T>(rows: T[], columns: ExportColumn<T>[]) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n<events>\n`;
  const footer = `</events>\n`;

  const body = rows
    .map((row) => {
      const fields = columns
        .map(
          (column) =>
            `  <${column.key}>${escapeXml(
              String(column.value(row) ?? ""),
            )}</${column.key}>`,
        )
        .join("\n");

      return ` <event>\n${fields}\n </event>`;
    })
    .join("\n");

  return `${header}${body}\n${footer}`;
}

function rowsToXls<T>(rows: T[], columns: ExportColumn<T>[]) {
  const head = columns
    .map((column) => `<Cell><Data ss:Type="String">${escapeXml(column.label)}</Data></Cell>`)
    .join("");

  const body = rows
    .map((row) =>
      `<Row>${columns
        .map(
          (column) =>
            `<Cell><Data ss:Type="String">${escapeXml(
              String(column.value(row) ?? ""),
            )}</Data></Cell>`,
        )
        .join("")}</Row>`,
    )
    .join("");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<?mso-application progid="Excel.Sheet"?>`,
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"`,
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`,
    `<Worksheet ss:Name="Events"><Table>`,
    `<Row>${head}</Row>`,
    body,
    `</Table></Worksheet></Workbook>`,
  ].join("");
}

export function buildExport<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  format: ExportFormat,
): string {
  switch (format) {
    case "csv":
      return rowsToText(rows, columns, ",", true);
    case "tsv":
      return rowsToText(rows, columns, "\t", false);
    case "txt":
      return rowsToTextAligned(rows, columns);
    case "json":
      return rowsToJson(rows, columns);
    case "xml":
      return rowsToXml(rows, columns);
    case "xls":
      return rowsToXls(rows, columns);
    default:
      return "";
  }
}

export function downloadFile(
  content: string,
  filename: string,
  mime: string,
) {
  const blob = new Blob([`﻿${content}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportData<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  format: ExportFormat,
  baseName: string,
) {
  const spec = EXPORT_FORMATS.find((item) => item.key === format);
  const stamp = new Date().toISOString().slice(0, 10);

  downloadFile(
    buildExport(rows, columns, format),
    `${baseName}-${stamp}.${format}`,
    spec?.mime ?? "text/plain;charset=utf-8",
  );
}
