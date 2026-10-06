import { BOARD_SQUARES } from './board.js';

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
    calculateRent(square, ownerPlayer, diceTotal = 0) {
        // Propiedades normales
        if (square.type === 'property' && square.rent) {

            const propertyState = this.propertiesState?.[square.id] || {};

            if (propertyState.mortgaged) return 0;

            const buildings = {
                houses: propertyState.houses || 0,
                hotel: propertyState.hotel || false
            };

            const groupProperties = BOARD_SQUARES.filter(
                property =>
                    property.type === 'property' &&
                    property.group === square.group
            );

            const ownsEntireGroup = groupProperties.every(
                property =>
                    (ownerPlayer?.properties || []).includes(property.id)
            );

            // Grupo completo sin construcciones
            if ( (buildings.houses || 0) === 0 && !buildings.hotel && ownsEntireGroup ) {
                return square.rent[0] * 2;
            }

            // Hotel
            if (buildings.hotel) return square.rent[5];

            // Casas: 0, 1, 2, 3 o 4
            const houses = buildings.houses || 0;

            return square.rent[houses];
        }

        // Ferrocarriles
        if (square.type === 'railroad') {

            if (!ownerPlayer) return 25;

            const propertyState = this.propertiesState?.[square.id] || {};

            if (propertyState.mortgaged) return 0;

            const railroadCount = (ownerPlayer.properties || []).filter(propertyId => {
                    const railroad = BOARD_SQUARES.find( square => square.id === propertyId );
                    return railroad?.type === 'railroad';
            }).length;

            const railroadRents = {
                1: 25,
                2: 50,
                3: 100,
                4: 200
            };
            return railroadRents[railroadCount] || 25;
        }

        // Servicios públicos
        if (square.type === 'utility') {
            const propertyState = this.propertiesState?.[square.id] || {};

            if (propertyState.mortgaged) return 0;

            const utilityCount = (ownerPlayer?.properties || []).filter(propertyId => {
                const utility = BOARD_SQUARES.find( square => square.id === propertyId );
                return utility?.type === 'utility';
            }).length;

            if (utilityCount >= 2) return diceTotal * 10;
            return diceTotal * 4;
        }
        return 0;
    }

    calculatePropertyRepairCost(player, houseCost, hotelCost) {
        let totalCost = 0;

        for (const propertyId of player.properties || []) {
            const buildings = this.propertiesState?.[propertyId] || {};
            const houses = buildings.houses || 0;
            const hotel = buildings.hotel ? 1 : 0;
            totalCost += houses * houseCost;
            totalCost += hotel * hotelCost;
        }
        return totalCost;
    }

    canBuildOnProperty(player, propertyId) {
        // Buscar la propiedad en el tablero
        const property = BOARD_SQUARES.find(
            square => square.id === propertyId
        );

        if (!property) {
            return {
                allowed: false,
                message: "La propiedad no existe."
            };
        }

        // Solo se puede construir en propiedades normales
        if (property.type !== 'property') {
            return {
                allowed: false,
                message: "No se puede construir en esta casilla."
            };
        }

        // El jugador debe ser dueño de la propiedad
        if (!(player.properties || []).includes(propertyId)) {
            return {
                allowed: false,
                message: "No eres dueño de esta propiedad."
            };
        }

        const propertyState = this.propertiesState?.[propertyId] || {};

        if (propertyState.mortgaged) {
            return {
                allowed: false,
                message: "No puedes construir en una propiedad hipotecada."
            };
        }

        // Obtener todas las propiedades del mismo grupo
        const groupProperties = BOARD_SQUARES.filter(
            square =>
                square.type === 'property' &&
                square.group === property.group
        );

        // Verificar que el jugador tenga TODO el grupo
        const ownsEntireGroup = groupProperties.every(
            groupProperty => (player.properties || []).includes(groupProperty.id)
        );

        if (!ownsEntireGroup) {
            return {
                allowed: false,
                message: "Debes ser dueño de todas las propiedades de este grupo para construir."
            };
        }

        // Obtener la cantidad de casas de cada propiedad directamente desde el estado sincronizado de Firebase
        const groupBuildings = groupProperties.map(groupProperty => {
            const buildings = this.propertiesState?.[groupProperty.id] || {
                houses: 0,
                hotel: false
            };

            return {
                propertyId: groupProperty.id,
                houses: buildings.houses || 0,
                hotel: buildings.hotel || false
            };
        });

        const currentBuildings = groupBuildings.find( building => building.propertyId === propertyId );
        const minimumHouses = Math.min(
            ...groupBuildings.map(
                building => building.houses
            )
        );

        // No se puede construir si esta propiedad ya está por encima de otra del grupo
        if (currentBuildings.houses > minimumHouses) {
            return {
                allowed: false,
                message: "Debes construir primero en las propiedades del grupo que tienen menos casas."
            };
        }

        // Obtener edificios actuales de esta propiedad desde el estado sincronizado
        const buildings =
            this.propertiesState?.[propertyId] || {
                houses: 0,
                hotel: false
            };

        // Si ya tiene hotel, no puede seguir construyendo
        if (buildings.hotel) {
            return {
                allowed: false,
                message: "Esta propiedad ya tiene un hotel."
            };
        }

        // Máximo de 4 casas antes del hotel
        if ((buildings.houses || 0) >= 4) {
            return {
                allowed: false,
                message: "Esta propiedad tiene 4 casas. Puede convertirse en hotel."
            };
        }

        return {
            allowed: true,
            buildings
        };
    }
}