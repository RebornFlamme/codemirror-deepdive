import { EditorView } from '../src/view/src/editorview';
import { EditorState } from './state/src/state.ts';

const view = new EditorView({
  state: EditorState.create({
    doc: "hello\nword"
  }),
  parent: document.body
});

view.dispatch(view.state.update({ changes: { from: 5, insert: " there" } }));

