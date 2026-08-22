import { flatten, type Extension } from "./extension";
import type { EditorState } from "./state";
import { Transaction } from "./transaction";

// nextID est au niveau module et pas une variable statique de Facet
// parce qu'il est partagé par plusieurs modules 

// Facet.define permet de crée une facet 
// tabSize = Facet.define(...)
// puis on cr

let nextID = 0;

export class Facet<Input, Output> {
    readonly id: number;
    readonly combine: (values: readonly Input[]) => Output;
    readonly default: Output

    constructor(combine: (values: readonly Input[]) => Output) {
        this.id = nextID ++;
        this.combine = combine;
        this.default = combine([]);
    }

    // le constructeur intelligent
    static define<Input, Output = readonly Input[]>(
        config?: {combine?: (values: readonly Input[]) => Output }
    ): Facet<Input, Output> {
        
        let combine;

        if (!(config && config.combine)) {
            combine = (values: readonly Input[]): Output => values as Output;
        } else {
            combine = config.combine;
        };
        
        return(new Facet(combine));
    }

    // of retourne un FacetProvider qui vise à aller dans l'arbre des extensions
    // tabSize.of(2) -> la Facet Tabsize recoit la valeur 2
    of(value: Input): Extension {
        return(new FacetProvider(this, value));
    }

}

// EditorState n'a que 2 champs : 
// doc & selection
// mais des extensions ont besoin de stocker autre chose dans l'état (exemple undo-redo)
// Pattern : 
// Reducer (etat, action) => nouvel_etat
// Note importante le StateField est passif, c'est EditorState qui a l'initiative
// Bien noter ce pattern d'inversion de controle 
// ça permet de ne jamais monkey-patch
// Facet vs StateField
// N valeurs combinées vs 1 valeur
// update : 1 fois à la résolution de la config vs à chaque transaction
// agrégation statique de la config vs etat dynamique qui évolue

interface StateFieldSpec<Value> {
    // Ok on passe tout le state, c'est logique d'avoir accès à l'éditeur en entier ! 
    create: (state: EditorState) => Value;
    update: (value: Value, tr: Transaction) => Value;
    compare?: (a: Value, b: Value) => boolean;
}

// voir que StateField n'est qu'un objet descriptif
// il ne contient pas sa propre valeur courante, ça c'ets le rôle de state !
export class StateField<Value> {

    readonly id: number;
    create: (state: EditorState) => Value;
    update: (value: Value, tr: Transaction) => Value;
    compare: ((a: Value, b: Value) => boolean);

    private constructor(
        create: (state: EditorState) => Value, 
        update: (value: Value, tr: Transaction) => Value, 
        compare: (a: Value, b: Value) => boolean
    ) {
        this.id = nextID ++;
        this.create = create;
        this.update = update;
        this.compare = compare;
    };

    static define<Value>(spec: StateFieldSpec<Value>): StateField<Value> {

        return(new StateField(
            spec.create,
            spec.update,
            spec.compare ?? ((a, b) => a === b)
        ));
    }

    get extension(): Extension {
        return(this);
    }

}

export class FacetProvider<Input> {
    declare extension: Extension   // Kludge to convince the type system these count as extensions
    constructor(readonly facet: Facet<Input, any>, readonly value: Input) {}
}

export class Configuration {
    
    // prend une liste de FacetProvider 
    // Configuration.resolve  
    // 1. flatten          [ FP{tabSize,2}, FP{tabSize,8} ]         ← aplatir l'arbre
    // 2. grouper par id   { 0: [2, 8] }                            ← rassembler par facet
    // 3. combine          { 0: tabSize.combine([2,8]) } = { 0: 2 } ← fondre en UNE valeur
    // config = { valeurs par id: { 0: 2 } }
    private constructor(
        // valeurs de facets déjà combinées, indexées par facet.id
        private readonly facetValues: Map<number, any>,
        // les champs d'état rencontrés — EditorState en aura besoin
        readonly fields: readonly StateField<any>[]
    ) {}

    static resolve(extension: Extension): Configuration {
        // 1. aplatir l'arbre en une liste de feuilles
        const leaves = flatten(extension);

        // 2. séparer : les StateField d'un côté, les providers groupés par facet
        const fields: StateField<any>[] = [];
        const groups = new Map<Facet<any, any>, any[]>();

        for (const ext of leaves) {
            if (ext instanceof StateField) {
                fields.push(ext);
            } else {
                // ext est un FacetProvider ici
                let values = groups.get(ext.facet);
                if (!values) {
                    values = [];
                    groups.set(ext.facet, values);
                }
                values.push(ext.value);
            }
        }

        // 3. fondre chaque groupe en UNE valeur, rangée sous facet.id
        const facetValues = new Map<number, any>();
        for (const [facet, values] of groups) {
            facetValues.set(facet.id, facet.combine(values));
        }

        return new Configuration(facetValues, fields);
    }

    facet<Output>(facet: Facet<any, Output>): Output {
        // valeur pré-combinée si un provider a contribué, sinon le défaut du facet
        return this.facetValues.has(facet.id)
            ? this.facetValues.get(facet.id)
            : facet.default;
    }
}