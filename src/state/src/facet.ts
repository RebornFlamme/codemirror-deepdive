import type { Extension } from "./extension";

// nextID est au niveau module et pas une variable statique de Facet
// parce qu'il est partagé par plusieurs modules 
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
        // si combine n'est pas défini on prend le premier
        if (!(config && config.combine)) {
            combine: (values: readonly Input[]) => Output = (values: readonly Input[]) => values.length ? values[0] : );
        }
        
        return(new Facet(combine));
    }

    // of retourne un FacetProvider qui vise à aller dans l'arbre des extensions
    // tabSize.of(2) -> la Facet Tabsize recoit la valeur 2
    of(value: Input): Extension {

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
    static resolve(extension: Extension): Configuration {

    }
    
    facet<Output>(facet: Facet<any, Output>): Output {

    }
}