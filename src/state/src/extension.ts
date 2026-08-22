import { FacetProvider, StateField } from "./facet";

// type réccursif ! qui permet de passer en extension une liste d'extention ! 
export type Extension = { extension: Extension } | readonly Extension[];

export function flatten(extension: Extension): readonly (FacetProvider<any> | StateField<any>)[] {

    let result: (FacetProvider<any> | StateField<any>)[] = [];

    if (Array.isArray(extension)) {
        for (const ext of extension) {
            if (ext instanceof FacetProvider) {
                result.push(ext);
            } else if (ext instanceof StateField) {
                result.push(ext);
            } else {
                result = result.concat(flatten(ext));
            }
        };
    } else {
        if (extension instanceof FacetProvider || extension instanceof StateField) {
            result.push(extension);
        } else {
            result = result.concat(flatten((extension as any).extension));
        }
    };
    return(result);
}


// Révélation : 
// Extensions, c'est un arbre d'affectation à des facets ! 
// ie dans la liste c'est que des affectations à des facets ! 