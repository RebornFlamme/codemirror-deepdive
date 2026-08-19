import { DefaultSplit, ChangeSet, type ChangeSpec } from "./change";
import { checkSelection, EditorSelection } from "./selection";
import { Text } from "./text";
import { Transaction, asArray, type TransactionSpec } from './transaction';


interface EditorStateConfig {
    doc?: string | Text;
    selection?: EditorSelection | {anchor: number, head?: number};
    // extensions?: Extention
}

export class EditorState {
    readonly doc: Text;
    readonly selection: EditorSelection;

    private constructor(doc: Text, selection: EditorSelection) {
        this.doc = doc;
        this.selection = selection;
    }

    // c'est la fonction qui donne l'EditorState au démarrage
    // après on ne recrée plus jamais un State manuellement on fait des transactions
    // remarque de style : pourquoi ne pas mettre toute cette logique dans le constructor? 
    // on découple parce que create n'est pas
    static create(config: EditorStateConfig = {}): EditorState {
        // Normalisation du document
        // ?? c'est pour un fallback
        const doc = config.doc instanceof Text ? config.doc : Text.of((config.doc ??  "").split(DefaultSplit));
        
        // Normalisation de la sélection 
        const selection = config.selection ? config.selection instanceof EditorSelection ? config.selection : EditorSelection.single(config.selection.anchor, config.selection.head) : EditorSelection.single(0);

        // cette fonction throw s'il y a un souci
        checkSelection(selection, doc.length);

        return(new EditorState(doc, selection));
    }

    changes(spec: ChangeSpec = []): ChangeSet {
        return(ChangeSet.of(spec, this.doc.length));
    }

    update(spec: TransactionSpec): Transaction {
        // 1. les changements : soit un ChangeSet déjà prêt, soit on le fabrique
        const changes = spec.changes instanceof ChangeSet
            ? spec.changes
            : ChangeSet.of(spec.changes ?? [], this.doc.length);

        // 2. la sélection : absente -> undefined (PAS un curseur en 0 comme dans create).
        //    undefined = "fais survivre l'ancienne", c'est tr.newSelection qui s'en charge.
        const selection =
            !spec.selection                             ? undefined
            : spec.selection instanceof EditorSelection ? spec.selection
            : EditorSelection.single(spec.selection.anchor, spec.selection.head);

        // 3. les annotations : on absorbe en tableau, et userEvent n'est qu'un
        //    raccourci pour Transaction.userEvent.of(...)
        let annotations = asArray(spec.annotations);
        if (spec.userEvent) {
            annotations = annotations.concat(Transaction.userEvent.of(spec.userEvent));
        }

        // 4. les effets
        const effects = asArray(spec.effects);

        // 5. on assemble — rien n'est encore calculé, tout est paresseux
        return new Transaction(this, changes, selection, effects, annotations, !!spec.scrollIntoView);
    }

    applyTransaction(tr: Transaction): void {
        tr._state = new EditorState(tr.newDoc, tr.newSelection);
    }
}