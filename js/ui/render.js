import { BOARD_SQUARES } from '../core/board.js';

/**
 * Calcula las coordenadas (Columna, Fila) en un Grid de 11x11 basado en el ID de la casilla (0-39)
 * @param {number} id - Índice de la casilla del 0 al 39
 * @returns {{col: number, row: number}} Coordenadas basadas en 1-indexed para CSS Grid
 */

function getGridCoordinates(id) {
    if (id >= 0 && id <= 10) {
        return { col: 11 - id, row: 11 };
    }
    if (id >= 11 && id <= 20) {
        return { col: 1, row: 11 - (id - 10) };
    }
    if (id >= 21 && id <= 30) {
        return { col: 1 + (id - 20), row: 1 };
    }
    if (id >= 31 && id <= 39) {
        return { col: 11, row: 1 + (id - 30) };
    }
}

export function renderBoard() {
    const boardElement = document.getElementById('board');
    if (!boardElement) return;

    BOARD_SQUARES.forEach((square) => {
        const squareDiv = document.createElement('div');
        const coords = getGridCoordinates(square.id);

        // Clases e identificación por posición
        squareDiv.classList.add('square', `square-${square.id}`);
        squareDiv.style.gridColumn = coords.col;
        squareDiv.style.gridRow = coords.row;

        // Añade cabecera de color si es una propiedad
        if (square.type === 'property' && square.group) {
            const colorBar = document.createElement('div');
            colorBar.classList.add('property-bar', `group-${square.group}`);
            squareDiv.appendChild(colorBar);
        }

        // Contenedor de contenido de la casilla
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('square-content');

        const title = document.createElement('span');
        title.classList.add('square-title');
        title.textContent = square.name;
        contentDiv.appendChild(title);

        if (square.price) {
            const price = document.createElement('span');
            price.classList.add('square-price');
            price.textContent = `$${square.price}`;
            contentDiv.appendChild(price);
        }

        squareDiv.appendChild(contentDiv);

        // Contenedor interno para renderizar las fichas de los jugadores en esta casilla
        const tokensContainer = document.createElement('div');
        tokensContainer.classList.add('square-tokens');
        tokensContainer.id = `tokens-square-${square.id}`;
        squareDiv.appendChild(tokensContainer);

        boardElement.appendChild(squareDiv);
    });
}