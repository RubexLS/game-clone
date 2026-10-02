export class Player {
    /**
     * @param {string} id - ID único del jugador (enviado por Firebase o local)
     * @param {string} name - Nombre del jugador
     * @param {string} color - Color de su ficha (hex o nombre css)
     */
    constructor(id, name, color) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.money = 1500;       // Saldo inicial 
        this.position = 0;       // Todos empiezan en la casilla 0 (SALIDA)
        this.isJailed = false;   // Estado de prisión
        this.jailTurns = 0;
        this.getOutOfJailFreeCards = 0;
        this.properties = [];    // Array de IDs de casillas compradas
    }

    /**
     * Mueve al jugador una cantidad de casillas y gestiona el paso por la SALIDA
     * @param {number} steps - Suma de los dados a avanzar
     * @returns {boolean} True si pasó por la salida y cobró el bono
     */
    move(steps) {
        if (this.isJailed) {
            console.log(`${this.name} está en la cárcel. No puede moverse de forma normal.`);
            return false;
        }

        const oldPosition = this.position;
        // El tablero es circular (40 casillas: del 0 al 39)
        this.position = (this.position + steps) % 40;

        // Si la nueva posición es menor que la anterior, significa que dio la vuelta completa
        const passedGo = this.position < oldPosition;
        if (passedGo) {
            this.money += 200; // Bono clásico por pasar por SALIDA
        }

        return passedGo;
    }
}

/**
 * Dibuja o actualiza la ficha visual de un jugador en la casilla correspondiente
 * @param {Player} player 
 */
export function drawPlayerToken(player) {
    // 1. Eliminar la ficha de su posición anterior si existía
    const existingToken = document.getElementById(`token-${player.id}`);
    if (existingToken) {
        existingToken.remove();
    }

    // 2. Buscar el contenedor de fichas de la casilla actual
    const targetContainer = document.getElementById(`tokens-square-${player.position}`);
    if (!targetContainer) return;

    // 3. Crear el elemento visual de la ficha
    const tokenDiv = document.createElement('div');
    tokenDiv.id = `token-${player.id}`;
    tokenDiv.classList.add('token');
    tokenDiv.style.backgroundColor = player.color;
    tokenDiv.title = player.name; // Tooltip al pasar el mouse

    // 4. Insertarlo en la casilla
    targetContainer.appendChild(tokenDiv);
}