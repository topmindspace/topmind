import test from 'node:test';
import assert from 'node:assert/strict';
import { activeDocumentPath } from '../src/lib/active-document';

test('the most recently focused visible editor is the article, including split panes', () => {
  const state = {selection:{kind:'file' as const,path:'A.md'},splitSecondaryPath:'B.md',focusedEditorPath:'B.md'};
  assert.equal(activeDocumentPath(state),'B.md');
  assert.equal(activeDocumentPath({...state,splitSecondaryPath:null}),'A.md');
  assert.equal(activeDocumentPath({...state,selection:{kind:'file',path:'C.md'},splitSecondaryPath:null}),'C.md');
  assert.equal(activeDocumentPath({...state,selection:{kind:'stream'}}),null);
});
