// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answer as csv-reader's readCsv for every input {text, header}:
// {columns, rows, errors}. Written as one flat pass over the text:
// fields are taken with slice() at their delimiters instead of being
// built one character at a time, quoted fields find their next quote
// with indexOf, and the slow paths (stray CRs, line breaks inside
// quotes, doubled quotes, junk after a closing quote, unterminated
// quotes) only run when the input actually needs them.
//
// Policy (csv-reader 1.0.0, as the reference reads it):
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR
//     inside it is read as LF; what follows the closing quote, up to the
//     next comma or line break, is appended as it stands (quote_junk,
//     when the field ends); a quote that never closes is a literal
//     character and the text after it is read again as unquoted
//     (unterminated_quote); a quote inside an unquoted field is literal;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows
//     are padded with "" (short_row, with fields: its field count) or cut
//     (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met, line the 1-based
//     line its record starts on, row its record's index in rows, null for
//     the header.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let lastQuoted = false;

    do {
      let value;
      if (text.charCodeAt(pos) === 34) {
        // ---- quoted field ----
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        let i = pos + 1;
        let segStart = i;
        let head = null; // first clean segment, while parts === null
        let parts = null; // segments, allocated only when needed
        let closed = -1; // position of the closing quote, -1: none found
        while (true) {
          const q = text.indexOf('"', i);
          if (q === -1) {
            // The quote never closes: it is a literal character, and the
            // text after it is read again as unquoted.
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            let v = '"';
            let start = open + 1;
            let p = open + 1;
            let e;
            while (true) {
              if (p >= n) {
                v += text.slice(start, p);
                e = END;
                break;
              }
              const c = text.charCodeAt(p);
              if (c === 44) {
                v += text.slice(start, p);
                p += 1;
                e = COMMA;
                break;
              }
              if (c === 10) {
                v += text.slice(start, p);
                p += 1;
                line += 1;
                e = LINE_BREAK;
                break;
              }
              if (c === 13) {
                if (p + 1 < n && text.charCodeAt(p + 1) === 10) {
                  v += text.slice(start, p);
                  p += 2;
                  line += 1;
                  e = LINE_BREAK;
                  break;
                }
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                v += text.slice(start, p);
                p += 1;
                start = p;
                continue;
              }
              p += 1;
            }
            pos = p;
            value = v;
            ended = e;
            break;
          }
          if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
            // Doubled quote: the segment [segStart, q) is content, then
            // one literal quote.
            const lf = text.indexOf('\n', segStart);
            const hasLF = lf !== -1 && lf < q;
            const cr = text.indexOf('\r', segStart);
            const hasCR = cr !== -1 && cr < q;
            if (!hasLF && !hasCR) {
              const seg = text.slice(segStart, q);
              if (parts === null && head === null) head = seg;
              else {
                if (parts === null) {
                  parts = [head];
                  head = null;
                }
                parts.push(seg);
              }
            } else {
              let s = '';
              let j = segStart;
              let sub = segStart;
              while (j < q) {
                const c = text.charCodeAt(j);
                if (c === 13) {
                  if (sub < j) s += text.slice(sub, j);
                  s += '\n';
                  line += 1;
                  j += j + 1 < q && text.charCodeAt(j + 1) === 10 ? 2 : 1;
                  sub = j;
                } else if (c === 10) {
                  if (sub < j) s += text.slice(sub, j);
                  s += '\n';
                  line += 1;
                  j += 1;
                  sub = j;
                } else {
                  j += 1;
                }
              }
              if (sub < q) s += text.slice(sub, q);
              if (parts === null && head === null) head = s;
              else {
                if (parts === null) {
                  parts = [head];
                  head = null;
                }
                parts.push(s);
              }
            }
            if (parts === null) {
              parts = head === null ? [] : [head];
              head = null;
            }
            parts.push('"');
            i = q + 2;
            segStart = i;
            continue;
          }
          // Closing quote at q: the last segment is [segStart, q).
          closed = q;
          const lf = text.indexOf('\n', segStart);
          const hasLF = lf !== -1 && lf < q;
          const cr = text.indexOf('\r', segStart);
          const hasCR = cr !== -1 && cr < q;
          if (!hasLF && !hasCR) {
            const seg = text.slice(segStart, q);
            if (parts === null && head === null) head = seg;
            else {
              if (parts === null) {
                parts = [head];
                head = null;
              }
              parts.push(seg);
            }
          } else {
            let s = '';
            let j = segStart;
            let sub = segStart;
            while (j < q) {
              const c = text.charCodeAt(j);
              if (c === 13) {
                if (sub < j) s += text.slice(sub, j);
                s += '\n';
                line += 1;
                j += j + 1 < q && text.charCodeAt(j + 1) === 10 ? 2 : 1;
                sub = j;
              } else if (c === 10) {
                if (sub < j) s += text.slice(sub, j);
                s += '\n';
                line += 1;
                j += 1;
                sub = j;
              } else {
                j += 1;
              }
            }
            if (sub < q) s += text.slice(sub, q);
            if (parts === null && head === null) head = s;
            else {
              if (parts === null) {
                parts = [head];
                head = null;
              }
              parts.push(s);
            }
          }
          pos = q + 1;
          break;
        }
        if (closed !== -1) {
          value = parts === null ? head : parts.join('');
          if (pos >= n) {
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = LINE_BREAK;
            } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands,
              // up to the next comma or line break.
              let v = value;
              let start = pos;
              let p = pos;
              let added = 0;
              let e;
              while (true) {
                if (p >= n) {
                  const s = text.slice(start, p);
                  v += s;
                  added += s.length;
                  e = END;
                  break;
                }
                const cc = text.charCodeAt(p);
                if (cc === 44) {
                  const s = text.slice(start, p);
                  v += s;
                  added += s.length;
                  p += 1;
                  e = COMMA;
                  break;
                }
                if (cc === 10) {
                  const s = text.slice(start, p);
                  v += s;
                  added += s.length;
                  p += 1;
                  line += 1;
                  e = LINE_BREAK;
                  break;
                }
                if (cc === 13) {
                  if (p + 1 < n && text.charCodeAt(p + 1) === 10) {
                    const s = text.slice(start, p);
                    v += s;
                    added += s.length;
                    p += 2;
                    line += 1;
                    e = LINE_BREAK;
                    break;
                  }
                  errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                  const s = text.slice(start, p);
                  v += s;
                  added += s.length;
                  p += 1;
                  start = p;
                  continue;
                }
                p += 1;
              }
              pos = p;
              if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = v;
              ended = e;
            }
          }
        }
      } else {
        // ---- unquoted field ----
        lastQuoted = false;
        let v = '';
        let start = pos;
        let p = pos;
        let e;
        while (true) {
          if (p >= n) {
            v += text.slice(start, p);
            e = END;
            break;
          }
          const c = text.charCodeAt(p);
          if (c === 44) {
            v += text.slice(start, p);
            p += 1;
            e = COMMA;
            break;
          }
          if (c === 10) {
            v += text.slice(start, p);
            p += 1;
            line += 1;
            e = LINE_BREAK;
            break;
          }
          if (c === 13) {
            if (p + 1 < n && text.charCodeAt(p + 1) === 10) {
              v += text.slice(start, p);
              p += 2;
              line += 1;
              e = LINE_BREAK;
              break;
            }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            v += text.slice(start, p);
            p += 1;
            start = p;
            continue;
          }
          p += 1;
        }
        pos = p;
        value = v;
        ended = e;
      }
      fields.push(value);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
