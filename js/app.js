import { renderBoard } from './ui/render.js';
import { Player, drawPlayerToken } from './core/player.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log("Inicializando Clon de Monopoly...");
    
    // 1. Dibuja el tablero en la pantalla
    renderBoard();

    // 2. Crea un jugador local de prueba para testing
    const player1 = new Player("p1", "Jugador 1", "#e74c3c");
    
    // Dibuja su ficha por primera vez en la casilla 0
    drawPlayerToken(player1);

    // 3. Captura los elementos de la UI local
    const btnRollDice = document.getElementById('btn-roll-dice');
    const diceView = document.getElementById('dice-view');
    const logMessages = document.getElementById('log-messages');

    // Habilita el botón de dados para la prueba local
    if (btnRollDice) btnRollDice.disabled = false;

    // 4. Lógica del evento para lanzar dados de prueba
    btnRollDice?.addEventListener('click', () => {
        // Lanzamos dos dados (valores entre 1 y 6)
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;

        // Actualiza la vista de los dados
        diceView.textContent = `🎲 ${die1}  🎲 ${die2} (Total: ${total})`;

        // Mueve al jugador lógicamente
        const passedGo = player1.move(total);

        // Actualiza su ficha visualmente en el nuevo casillero
        drawPlayerToken(player1);

        // Imprime un log rápido en pantalla
        const log = document.createElement('p');
        log.textContent = `${player1.name} sacó ${total} y se movió a la casilla ${player1.position}.`;
        if (passedGo) {
            log.textContent += " ¡Pasó por SALIDA y reclamó \$200!";
        }
        logMessages.appendChild(log);
        logMessages.scrollTop = logMessages.scrollHeight; // Auto-scroll hacia abajo
    });
});
