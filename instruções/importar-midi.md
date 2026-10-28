# Importação a partir de um MIDI
> Quando usar: o app avisa que criou a música a partir de um arquivo MIDI e gravou a leitura dele em `Análises/`.

A primeira mensagem traz onde está o original (`Importado/<pasta>/<arquivo>.mid`, somente leitura) e a leitura que o app fez dele (`Análises/<nome> - leitura do MIDI.md`: andamento, compasso, armadura, tonalidade estimada, trilhas, instrumentos, marcadores, letra). Você não lê o `.mid`: use essa leitura. O nome da música já foi escolhido na tela; não pergunte de novo.
1. **Primeira resposta: só perguntas, nenhuma gravação.** Leia a leitura do MIDI e responda com:
   - um resumo de 3 a 5 linhas do que o arquivo mostra (andamento, compasso, tom, duração, instrumentos, marcadores que pareçam partes);
   - as perguntas, numeradas e curtas, todas na mesma mensagem: gênero e estilo; referências (artistas/músicas); estrutura (partes e onde começam; se houver marcadores, proponha a estrutura a partir deles e peça confirmação); se a música está finalizada, em andamento ou é um esboço; o que este MIDI é (a música inteira, um trecho, uma demo, uma ideia solta); se o tom e o BPM lidos conferem (diga quando o tom é só estimado); o que quer fazer com ela a seguir.
   - avise que pode responder só o que souber.
2. **Depois das respostas**, monte a música sem pedir confirmação a cada passo:
   - reescreva `_índice.md` no formato do Sostituto (frontmatter `tom`, `bpm`, `gênero`, `referências`, `status`; seções de intenção, estrutura, regras desta música, onde paramos). Tom/BPM só entram no frontmatter se o usuário confirmou ou se foram lidos do arquivo e ele não contestou; tom apenas estimado fica no texto como "estimado, a confirmar". `status`: `finalizada`, `em andamento` ou `esboço`, conforme a resposta;
   - copie o MIDI com `copiar_arquivo`: para `Ideias/` se for trecho, esboço ou ideia (e crie `Ideias/<nome>.md` no formato de ideia, apontando para ele, com `#em-dúvida` se o usuário não disser nada), ou para `Análises/` se for a música inteira;
   - na leitura do MIDI em `Análises/`, acrescente no fim uma seção "Confirmado pelo usuário" com o que ele corrigiu ou confirmou (não apague a leitura original);
   - na sessão de hoje, escreva uma seção "Importação" com o que foi para onde, as respostas do usuário e o que ficou em aberto.
   - O que o usuário afirmar sobre a música (gênero, estrutura, estado) é informação dele; preferências e escolhas explícitas entram como **Decisão minha**. Sugestões suas não viram decisão.
   - Termine com um resumo curto e pergunte por onde quer começar.
