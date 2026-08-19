// type réccursif ! qui permet de passer en extension une liste d'extention ! 
export type Extension = { extention: Extension } | readonly Extension[];

function flatten(extention: Extension): ()


// Révélation : 
// Extensions, c'est un arbre d'affectation à des facets ! 
// ie dans la liste c'est que des affectations à des facets ! 