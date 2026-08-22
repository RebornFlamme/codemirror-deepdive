// Dans un DOM classique on modifie les éléments à la main
// le DOM est alors la source de véritée, ici on fait l'inverse
// 

import { EditorState } from "../../state/src/state";
import type { Transaction } from "../../state/src/transaction";

export interface EditorViewConfig {
    state?: EditorState
    parent?: Element | DocumentFragment
};

export class EditorView {
    
    private _state: EditorState;
    parent: Element | DocumentFragment;

    readonly dom: HTMLElement; // .cm-editor
    readonly scrollDOM: HTMLElement; // .cm-scroller
    readonly contentDOM: HTMLElement; // .cm-content

    constructor(config?: EditorViewConfig) {
        
        if (!config || !config.state) {
            this._state = EditorState.create();
        } else {
            this._state = config.state;
        };

        if (!config || !config.parent) {
            this.parent = document.createDocumentFragment();
        } else {
            this.parent = config.parent;
        };

        // Hiérarchie editor > scroller > content

        this.dom = document.createElement('div');
        this.dom.className = 'cm-editor';
        this.parent.appendChild(this.dom);

        this.scrollDOM = document.createElement('div');
        this.scrollDOM.className = 'cm-scroller';
        this.dom.appendChild(this.scrollDOM);

        this.contentDOM = document.createElement('div');
        this.contentDOM.className = 'cm-content';
        this.scrollDOM.appendChild(this.contentDOM);

        // on rend une première fois la view
        this.render();
    };

    get state(): EditorState {
        return(this._state);
    };

    private render(): void {
        // 1. Vider content.DOM
        // 2. Une ligne = une div .cm-line
        // Vider : il n'y a pas de hook
        // for (const child of this.contentDOM.children) {
        //     this.contentDOM.removeChild(child);
        // };
        this.contentDOM.replaceChildren();

        for (let i = 1 ; i <= this.state.doc.lines ; i ++) {
            // Rappel doc est un Text 
            // lines est le nb de lignes du document
            // .line rend un objet Line avec from to le texte ...
            // rq : la numérotation commence bien à 1 ! 
            const text = this.state.doc.line(i).text
            const line = document.createElement('div');
            line.className = '.cm-line';
            if (text) {                            
                line.textContent = text;
            } else {
                line.appendChild(document.createElement('br'));
            }
            this.contentDOM.appendChild(line);
        };
    };

    dispatch(tr: Transaction): void {
        this.update([tr]);
    };

    update(transactions: readonly Transaction[]): void {
        // se souvenir que là on a setup un getter qui apply transaction au state 
        this._state = transactions[transactions.length - 1].state;
        this.render();
    };

    setState(newState: EditorState): void {
        this._state = newState;
        this.render();
    };

    destroy(): void {
        // this.parent.removeChild(this.dom); }
        // parent.removeChild(this.dom) lève si le dom a été déplacé ailleurs entre-temps. 
        // this.dom.remove() est robuste et ne t'oblige pas à stocker parent 
        // (que tu peux repasser en variable locale du constructeur — il ne sert nulle part ailleurs).   
        
        this.dom.remove();
    };
};