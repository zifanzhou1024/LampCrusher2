// ui.js

export function initializeUI() {
    // Create the Start Menu.
    const startMenu = document.createElement('div');
    startMenu.id = 'startMenu';
    startMenu.style.position = 'absolute';
    startMenu.style.top = '70%'; // Adjusted from 50% to 70%
    startMenu.style.left = '50%';
    startMenu.style.transform = 'translate(-50%, -50%)';
    startMenu.style.textAlign = 'center';
    startMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    startMenu.style.padding = '20px';
    startMenu.style.borderRadius = '10px';
    startMenu.style.zIndex = '9999';

    const titleElement = document.createElement('h1');
    titleElement.textContent = 'Lamp Crusher 2';
    titleElement.style.color = 'white';
    titleElement.style.marginBottom = '20px';

    const startButton = document.createElement('button');
    startButton.textContent = 'Start Game';
    startButton.style.padding = '10px 20px';
    startButton.style.fontSize = '18px';
    startButton.style.backgroundColor = '#4CAF50';
    startButton.style.color = 'white';
    startButton.style.border = 'none';
    startButton.style.borderRadius = '5px';
    startButton.style.cursor = 'pointer';
    startButton.addEventListener('click', () => {
        if (window.startGame) {
            window.startGame('normal');
        }
    });

    const demoButton = document.createElement('button');
    demoButton.textContent = 'Demo Mode';
    demoButton.style.padding = '10px 20px';
    demoButton.style.fontSize = '18px';
    demoButton.style.backgroundColor = '#4CAF50';
    demoButton.style.color = 'white';
    demoButton.style.border = 'none';
    demoButton.style.borderRadius = '5px';
    demoButton.style.cursor = 'pointer';
    demoButton.style.marginLeft = '10px';
    demoButton.addEventListener('click', () => {
        if (window.startGame) {
            window.startGame('demo');
        }
    });

    startMenu.appendChild(titleElement);
    startMenu.appendChild(startButton);
    startMenu.appendChild(demoButton);
    document.body.appendChild(startMenu);

    // Create the Health/Score overlay.
    const healthAndScoreElement = document.createElement('div');
    healthAndScoreElement.id = 'healthAndScore';
    healthAndScoreElement.style.position = 'absolute';
    healthAndScoreElement.style.top = '10px';
    healthAndScoreElement.style.left = '50%';
    healthAndScoreElement.style.transform = 'translateX(-50%)';
    healthAndScoreElement.style.color = 'white';
    healthAndScoreElement.style.fontSize = '20px';
    healthAndScoreElement.style.fontFamily = 'Arial, sans-serif';
    healthAndScoreElement.style.zIndex = '9999';
    healthAndScoreElement.textContent = 'Health: 100 | Score: 0 | Time: 0 s';
    document.body.appendChild(healthAndScoreElement);

    // Create a dedicated container for score popups.
    const scorePopupContainer = document.createElement('div');
    scorePopupContainer.id = 'scorePopupContainer';
    scorePopupContainer.style.position = 'absolute';
    scorePopupContainer.style.top = '10px';
    scorePopupContainer.style.left = '50%';
    scorePopupContainer.style.transform = 'translateX(-50%)';
    scorePopupContainer.style.pointerEvents = 'none';
    scorePopupContainer.style.zIndex = '10000';
    document.body.appendChild(scorePopupContainer);

    return { startMenu, healthAndScoreElement, scorePopupContainer };
}

export function updateUI(health, score, time) {
    const healthAndScoreElement = document.getElementById('healthAndScore');
    if (healthAndScoreElement) {
        healthAndScoreElement.textContent = `Health: ${Math.floor(health)} | Score: ${score} | Time: ${time.toFixed(2)} s`;
    }
}

export function spawnScorePopup(increment) {
    const popupContainer = document.getElementById('scorePopupContainer');
    if (!popupContainer) return;

    const popup = document.createElement('span');
    popup.className = 'score-popup';
    // The text content here doesn’t need to include the exclamation mark since the CSS could have added it;
    // however, we’re leaving it in case you want it explicitly:
    popup.textContent = `+${increment}!`;

    // Append the popup to the dedicated container.
    popupContainer.appendChild(popup);

    // Remove the popup after 1 second.
    setTimeout(() => {
        popup.remove();
    }, 1000);
}

export function displayGameOverScreen(playAgainCallback) {
    const gameOverDiv = document.createElement('div');
    gameOverDiv.id = 'gameOver';
    gameOverDiv.style.position = 'absolute';
    gameOverDiv.style.top = '60%';
    gameOverDiv.style.left = '50%';
    gameOverDiv.style.transform = 'translate(-50%, -50%)';
    gameOverDiv.style.textAlign = 'center';
    gameOverDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    gameOverDiv.style.padding = '20px';
    gameOverDiv.style.borderRadius = '10px';
    gameOverDiv.style.zIndex = '9999';

    const gameOverText = document.createElement('h1');
    gameOverText.textContent = 'Game Over';
    gameOverText.style.color = 'white';
    gameOverText.style.marginBottom = '20px';

    const playAgainButton = document.createElement('button');
    playAgainButton.textContent = 'Play Again';
    playAgainButton.style.padding = '10px 20px';
    playAgainButton.style.fontSize = '18px';
    playAgainButton.style.backgroundColor = '#4CAF50';
    playAgainButton.style.color = 'white';
    playAgainButton.style.border = 'none';
    playAgainButton.style.borderRadius = '5px';
    playAgainButton.style.cursor = 'pointer';
    playAgainButton.addEventListener('click', () => {
        playAgainCallback();
        gameOverDiv.remove();
    });

    gameOverDiv.appendChild(gameOverText);
    gameOverDiv.appendChild(playAgainButton);
    document.body.appendChild(gameOverDiv);
}

export function removeGameOverScreen() {
    const gameOverDiv = document.getElementById('gameOver');
    if (gameOverDiv) {
        gameOverDiv.remove();
    }
}

export function displayWinScreen(playAgainCallback) {
    const winDiv = document.createElement('div');
    winDiv.id = 'winScreen';
    winDiv.style.position = 'absolute';
    winDiv.style.top = '60%';
    winDiv.style.left = '50%';
    winDiv.style.transform = 'translate(-50%, -50%)';
    winDiv.style.textAlign = 'center';
    winDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    winDiv.style.padding = '20px';
    winDiv.style.borderRadius = '10px';
    winDiv.style.zIndex = '9999';

    const winText = document.createElement('h1');
    winText.textContent = 'You Won!';
    winText.style.color = 'white';
    winText.style.marginBottom = '20px';

    const playAgainButton = document.createElement('button');
    playAgainButton.textContent = 'Play Again';
    playAgainButton.style.padding = '10px 20px';
    playAgainButton.style.fontSize = '18px';
    playAgainButton.style.backgroundColor = '#4CAF50';
    playAgainButton.style.color = 'white';
    playAgainButton.style.border = 'none';
    playAgainButton.style.borderRadius = '5px';
    playAgainButton.style.cursor = 'pointer';
    playAgainButton.addEventListener('click', () => {
        playAgainCallback();
        winDiv.remove();
    });

    winDiv.appendChild(winText);
    winDiv.appendChild(playAgainButton);
    document.body.appendChild(winDiv);
}
