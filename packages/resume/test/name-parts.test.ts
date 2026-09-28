// Names with more than two parts: the profile keeps every part, and the particles of a surname stay with the surname
// instead of being pushed into the middle name (or the whole name being refused as "not a name").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textLines } from '../src/import/lines.ts';
import { parseLines } from '../src/import/parse.ts';

const person = (nameLine: string) =>
  parseLines(
    textLines(`${nameLine}\njordan.testwell@example.com\n\nEXPERIENCE\n\nSoftware Engineer - Acme (2020 - 2023)\nWrote code other people ran.\n`),
    { source: 'text' },
  ).profile.personal;

test('a name with more parts keeps them all, and a surname keeps its particles', () => {
  const cases: Array<[string, [string, string | null, string]]> = [
    ['Ana Gomez', ['Ana', null, 'Gomez']],
    ['Ana Maria de la Cruz Fernandez', ['Ana', 'Maria', 'de la Cruz Fernandez']],
    ['Ana María de la Cruz Fernández', ['Ana', 'María', 'de la Cruz Fernández']],
    ['Jan van der Berg', ['Jan', null, 'van der Berg']],
    ['José María López García', ['José', 'María López', 'García']],
    ['Fatima bint Mohammed Al Rashid', ['Fatima', 'bint Mohammed', 'Al Rashid']],
    ['Maria de los Angeles Rodriguez', ['Maria', null, 'de los Angeles Rodriguez']],
    ['JOHN MICHAEL VAN DER BERG', ['JOHN', 'MICHAEL', 'VAN DER BERG']],
    ['John Michael Smith', ['John', 'Michael', 'Smith']],
  ];
  for (const [line, expected] of cases) {
    const p = person(line);
    assert.deepEqual([p.firstName, p.middleName, p.lastName], expected, line);
  }
});

test('a name with five or six parts is a name: it is not dropped with a warning', () => {
  for (const line of ['Ana María de la Cruz Fernández', 'Fatima bint Mohammed Al Rashid', 'María de los Ángeles Rodríguez']) {
    const r = parseLines(textLines(`${line}\njordan.testwell@example.com\n\nEXPERIENCE\n\nSoftware Engineer - Acme (2020 - 2023)\nWrote code.\n`), { source: 'text' });
    assert.equal(r.profile.personal.firstName, line.split(' ')[0], line);
    assert.ok(
      !r.warnings.some((w) => w.includes('was not read into the profile')),
      `${line}: a multi part name must not be reported as unread (${r.warnings.join(' | ')})`,
    );
  }
});
