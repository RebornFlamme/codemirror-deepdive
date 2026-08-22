import { DefaultSplit, ChangeSet, type ChangeSpec } from "./change";
import { checkSelection, EditorSelection } from "./selection";
import { Text } from "./text";
import { Transaction, asArray, type TransactionSpec } from './transaction';
import { Configuration, Facet, StateField } from "./facet";
import type { Extension } from "./extension";

interface EditorStateConfig {
    doc?: string | Text;
    selection?: EditorSelection | {anchor: number, head?: number};
    extensions?: Extension;
}

export class EditorState {
    readonly config: Configuration;
    readonly doc: Text;
    readonly selection: EditorSelection;
    readonly values: Map<StateField<any>, any>;

    private constructor(config: Configuration, doc: Text, selection: EditorSelection, values: Map<StateField<any>, any>) {
        this.config = config
        this.doc = doc;
        this.selection = selection;
        this.values = values;
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

        // Gestion de la configuration
        const configuration = Configuration.resolve(config.extensions ?? [])
        const values = new Map<StateField<any>, any>();

        // ici on construit maintenant sinon serpent qui se mord la queue
        // car create dans la classe StateField prend state en aergument
        const state = new EditorState(configuration, doc, selection, values);

        for (const field of configuration.fields) {
            values.set(field, field.create(state));
        };

        return(state);
    }

    // permet de lire la valeur d'un field
    field<T>(field: StateField<T>): T {
        if (!this.values.has(field)) {
            throw new RangeError("Champ absent de la configuration");
        } 
        return(this.values.get(field));
    }

    // permet de lire la valeur d'une facet
    facet<Output>(facet: Facet<any, Output>): Output {
        return(this.config.facet(facet));
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

        // on va update les StateFields
        const values = new Map<StateField<any>, any>();

        for (const field of this.config.fields) {
            values.set(field, field.update(this.values.get(field), tr))
        };

        tr._state = new EditorState(this.config, tr.newDoc, tr.newSelection, values);
    };


}