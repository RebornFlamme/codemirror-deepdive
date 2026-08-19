import type { ChangeSpec, ChangeSet } from "./change";
import type { EditorSelection } from "./selection";
import { Text } from "./text";
import { EditorState } from "./state";

// pourquoi c'est si compliqué : 
// On prend l'exemple d'un object 
// {origin: 1233, date: ....}
// si 2 plugins prennent le meme nom l'un casse l'autre
// le trick c'est que les clefs soient des instance d'une classe
// comme ça me^me si techniquement elles sont pareilles genre .name égaux
// 2 instances n'ont pas d'égalité phusoqie ! 
// voila pouruqoi la clef est un annotationType
// cela nous donne aussi le typage grace à <T>


// Exemple de flow 
// on insère en position 5, un plugin veut savoir plus tard si le collage est annulable
// transaction.time = Annotation.define<number>()
// ... 



// la clef
// on peut créer 2 instances du meme type
export class AnnotationType<T> {

    of(value: T): Annotation<T> {
        return(new Annotation(this, value));
    }
}

// le couple clef / valeur
export class Annotation<T> {
    readonly type: AnnotationType<T>;
    readonly value: T;

    constructor(type: AnnotationType<T>, value: T) {
        this.type = type;
        this.value = value;
    }

    static define<T>(): AnnotationType<T> {
        return(new AnnotationType<T>());
    } 
}

// c'est un jumeau d'annotation sauf qu'il porte une position ! 
// donc on y ajoute une méthode map qui prend en argument un ChangeDesc
class StateEffectType<Value> {}
class StateEffect<Value> {}

export interface TransactionSpec {
    // position par rapport au document actuel
    changes?: ChangeSpec;
    // positions dans le document modifié
    selection?: EditorSelection | {anchor: number, head?: number};
    // positions dans le document modifié 
    effects?: StateEffect<any> | readonly StateEffect<any>[];
    annotations?: Annotation<any> | readonly Annotation<any>[];
    userEvent?: string;
    scrollIntoView?: boolean
}

export class Transaction {
    readonly startState: EditorState;
    readonly changes: ChangeSet;
    readonly selection: EditorSelection | undefined;
    readonly effects: readonly StateEffect<any>[];
    readonly annotations: readonly Annotation<any>[];
    readonly scrollIntoView: boolean;
    
    _doc: Text | null = null;
    _state: EditorState | null = null;

    static time = Annotation.define<number>();
    static userEvent = Annotation.define<string>();

    constructor(
        startState: EditorState, 
        changes: ChangeSet,
        selection: EditorSelection | undefined,
        effects: readonly StateEffect<any>[], 
        annotations: readonly Annotation<any>[],
        scrollIntoView: boolean
    ) {
        this.startState = startState;
        this.changes = changes;
        this.selection = selection;
        this.effects = effects;
        this.annotations = annotations;
        this.scrollIntoView = scrollIntoView;
    }

    get newDoc(): Text {
        // ici j'ai remarqué le principe de clean architecture
        // le noyau Text ne connait pas les ChangeDesc / ChangeSet qui sont plus succeptibles d'évoluer ! 
        if (!this._doc) {
            this._doc = this.changes.apply(this.startState.doc); 
        } 
        return(this._doc);
    }
    get newSelection(): EditorSelection {
        if (this.selection) {
            return(this.selection);
        } else {
            return(this.startState.selection.map(this.changes));
        }
    }
    get state(): EditorState {
        if (!this._state) {
            this.startState.applyTransaction(this)
        } 
        return(this._state!);
    }

    get docChanged(): boolean {
        return(!this.changes.empty);
    }

    annotation<T>(type: AnnotationType<T>): T | undefined {
        for (const annotation of this.annotations) {
            if (annotation.type === type) {
                return(annotation.value)
            }
        }
        return(undefined);
    };

    isUserEvent(event: string): boolean {
        const e = this.annotation(Transaction.userEvent);
        return !!(e && (e === event ||
    (e.length > event.length && e.slice(0, event.length) === event && e[event.length] === "."))); 
    };

};

// tableau vide partagé : asArray est appelé deux fois par transaction
// (annotations, effects) et la plupart des specs n'en portent aucune.
// astuce pour faire de l'égalité physique
const none: readonly any[] = [];

// les casts sont obligatoires : Array.isArray est déclaré `arg is any[]`,
// or `readonly T[]` n'est pas assignable à `any[]` (un tableau en lecture
// seule ne peut pas se faire passer pour un mutable). TS ne peut donc pas
// retirer `readonly T[]` de l'union dans la branche else. CM6 fait pareil.
export function asArray<T>(value: undefined | T | readonly T[] ): readonly T[] {
    return(value == null ? none : Array.isArray(value) ? value as readonly T[] : [value as T]);
};

