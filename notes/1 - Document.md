# Le document

### Pourquoi ne pas le stocker sous forme de string? 

- En JS modifier un string = en réécrire un en entier -> cout élevé.
- Les conversions lignes <-> positions sont coûteuses. il faut aller chercher les \n en O(n)
- Le versionnement doit être bon marché -> il faut pouvoir partager la mémoire. 

### Solution 
CM6 utilise un rope : c'est un arbre binaire comme ceci. 

```
                 ●  len=11
              ┌──┴──┐
        ● len=5     ● len=6
        │           │
     "hello"     " world"
```
La plupart des opérations se font en O(log(n))
