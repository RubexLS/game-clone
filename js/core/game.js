export class GameManager {
    constructor() {
        this.propertiesState = {}; // Guarda el estado en la nube: { squareId: { ownerId, houses } }
    }

    /**
     * Valida si una propiedad puede ser comprada por un jugador
     * @param {Object} square - Datos de la casilla desde board.js
     * @param {Object} player - Instancia del jugador que cayó en ella
     * @returns {boolean} True si está libre y el jugador tiene dinero suficiente
     */
    canBuyProperty(square, player) {
        // Solo se compran tipos de casilla específicos
        const buyableTypes = ['property', 'railroad', 'utility'];
        if (!buyableTypes.includes(square.type)) return false;

        // Verificar si ya tiene dueño en el estado actual
        if (this.propertiesState[square.id]) return false;

        // Verificar fondos suficientes
        return player.money >= square.price;
    }

    /**
     * Calcula el alquiler básico que debe pagar un jugador al caer en propiedad ajena
     * @param {Object} square - Datos de la casilla
     * @returns {number} Monto a pagar (alquiler base)
     */
    calculateRent(square) {
        if (square.type === 'property' && square.rent) {
            return square.rent[0]; // Alquiler base sin casas por ahora
        }
        if (square.type === 'railroad') {
            return 25; // Alquiler base estándar de ferrocarril
        }
        if (square.type === 'utility') {
            return 25; // Alquiler base de servicios públicos
        }
        return 0;
    }
}