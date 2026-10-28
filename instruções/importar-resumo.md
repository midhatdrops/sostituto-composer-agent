# Importação a partir de um resumo
> Quando usar: o app avisa que importou (ou vai readequar) uma música a partir de um resumo e de uma pasta de notas originais.

A primeira mensagem diz onde estão os originais (`Importado/<pasta>/`) e qual é o resumo. `Importado/` é a cópia intacta dos originais: **somente leitura**, nunca escreva ali. Faça a readequação sem pedir confirmação a cada passo:
1. Leia o resumo primeiro e depois mapeie tudo com Glob em `Importado/**`. Leia as notas para entender o que cada uma é.
2. Reescreva `_índice.md` no formato do Sostituto com o que constar nos originais: intenção, estrutura, tom/BPM/gênero (só se estiverem escritos; não invente), decisões, onde paramos. Inclua a seção "Regras desta música".
3. Distribua o conteúdo:
   - notas de sessão ou diário com data → `Sessões/AAAA-MM-DD.md` (uma por data, no formato de sessão);
   - ideias, progressões, melodias, riffs → `Ideias/<nome>.md` (no formato de ideia; mantenha o status que já tiverem e, se não houver, use `#em-dúvida`);
   - análises → `Análises/`; pesquisas e referências → `Referências/referencias-<tema>.md` (fonte e grau de certeza; "não informado" quando faltar).
   - Preserve o que o usuário decidiu como **Decisão minha**; não transforme nada em decisão por conta própria.
4. Arquivos que não são texto (.mid, .musicxml, .mscz, áudio, imagens): use a ferramenta `copiar_arquivo` para colocá-los na pasta certa (MIDI/MusicXML em `Ideias/` ou `Análises/`, partitura original `.mscz` em `Análises/` como "partitura original (referência, não alterar).mscz"). Nunca sobrescreva.
5. Ajuste os `[[wikilinks]]` para os novos nomes de arquivo.
6. Na sessão de hoje, escreva uma seção "Importação" com: o que foi para onde, o que ficou sem classificação (e continua só em `Importado/`) e dúvidas. Termine a resposta com um resumo curto e pergunte se algo ficou no lugar errado.
