// Tests de lib/path-key.js — F3: R9, R23, R26
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isWindowsPath, pathKey, lastSegment, encodeProjectPath, looseEncodedKey } from '../lib/path-key.js';

test('[F3-R23] pathKey: los cuatro pares del requisito', () => {
  assert.equal(pathKey('C:\\Users\\Usuario\\App-Flyder'), pathKey('c:/users/usuario/app-flyder/'));
  assert.equal(pathKey('/home/user/proy/'), pathKey('/home/user/proy'));
  assert.notEqual(pathKey('/home/user/Proy'), pathKey('/home/user/proy'));
  assert.notEqual(pathKey('C:\\a\\b'), pathKey('D:\\a\\b'));
});

test('[F3-R23] pathKey: valores no válidos, raíces y normalización de . y ..', () => {
  assert.equal(pathKey(null), null);
  assert.equal(pathKey(''), null);
  assert.equal(pathKey(undefined), null);
  assert.equal(pathKey(42), null);
  assert.equal(pathKey('C:\\'), 'c:\\');
  assert.equal(pathKey('C:/'), 'c:\\');
  assert.equal(pathKey('/'), '/');
  assert.equal(pathKey('C:\\Users\\Usuario\\app-flyder'), 'c:\\users\\usuario\\app-flyder');
  assert.equal(pathKey('/home/user/./proy/../proy/'), '/home/user/proy');
  assert.equal(pathKey('C:\\a\\.\\b\\..\\c\\'), 'c:\\a\\c');
  assert.equal(pathKey('\\\\servidor\\Compartida\\Proy\\'), pathKey('\\\\SERVIDOR\\compartida\\proy'));
});

test('[F3-R23] isWindowsPath detecta por la forma de la cadena', () => {
  assert.equal(isWindowsPath('C:\\Users'), true);
  assert.equal(isWindowsPath('c:/users'), true);
  assert.equal(isWindowsPath('\\\\servidor\\share'), true);
  assert.equal(isWindowsPath('/home/user'), false);
  assert.equal(isWindowsPath('relativa\\ruta'), false);
  assert.equal(isWindowsPath('C:'), false);
});

test('[F3-R26] lastSegment: Windows, POSIX con barra final y nombre con espacio', () => {
  assert.equal(lastSegment('C:\\Users\\Usuario\\app-flyder'), 'app-flyder');
  assert.equal(lastSegment('/home/user/SDD-MUVER/'), 'SDD-MUVER');
  assert.equal(lastSegment('C:\\Users\\Usuario\\Mi Proyecto'), 'Mi Proyecto');
  assert.equal(lastSegment('C:/mezcla\\de/separadores\\'), 'separadores');
  assert.equal(lastSegment('sin-separador'), 'sin-separador');
  assert.equal(lastSegment('/'), '/');
});

test('[F3-R9] encodeProjectPath sustituye / \\ y : por -', () => {
  assert.equal(encodeProjectPath('C:\\Users\\Usuario\\app-flyder'), 'C--Users-Usuario-app-flyder');
  assert.equal(encodeProjectPath('/home/user/SDD-MUVER'), '-home-user-SDD-MUVER');
});

test('[F3-R9] looseEncodedKey: minúsculas y todo lo no alfanumérico a -', () => {
  assert.equal(looseEncodedKey('C--Users-Usuario-app.flyder'), 'c--users-usuario-app-flyder');
  assert.equal(looseEncodedKey(encodeProjectPath('C:\\Users\\Usuario\\app_flyder')), looseEncodedKey('C--Users-Usuario-app-flyder'));
  assert.notEqual(looseEncodedKey('C--Users-Usuario-otro'), looseEncodedKey('C--Users-Usuario-app-flyder'));
});
