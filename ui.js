// ui.js

export function initializeUI() {
    // Create the initial Start Menu with only "Play Now" and "Demo Mode".
    const startMenu = document.createElement('div');
    startMenu.id = 'startMenu';
    // Position the menu at 75% of the screen height.
    startMenu.style.position = 'absolute';
    startMenu.style.top = '65%';
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

    // "Play Now" button opens the mode selection menu.
    const playNowButton = document.createElement('button');
    playNowButton.textContent = 'Play Now';
    playNowButton.style.padding = '10px 20px';
    playNowButton.style.fontSize = '18px';
    playNowButton.style.backgroundColor = '#4CAF50';
    playNowButton.style.color = 'white';
    playNowButton.style.border = 'none';
    playNowButton.style.borderRadius = '5px';
    playNowButton.style.cursor = 'pointer';
    playNowButton.addEventListener('click', () => {
        // Remove the initial menu; leave infoBox until a mode is selected.
        startMenu.remove();
        createModeSelectionMenu();
    });

    // "Demo Mode" button starts the game in demo mode immediately.
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
        // Remove the info box and start menu after game starts.
        const infoBox = document.getElementById('infoBox');
        if(infoBox) infoBox.remove();
        const menu = document.getElementById('startMenu');
        if(menu) menu.remove();
    });

    // Append title and buttons to the start menu.
    startMenu.appendChild(titleElement);
    startMenu.appendChild(playNowButton);
    startMenu.appendChild(demoButton);
    document.body.appendChild(startMenu);

    // Create an information box at the bottom of the page.
    const infoBox = document.createElement('div');
    infoBox.id = 'infoBox';
    infoBox.style.position = 'absolute';
    infoBox.style.bottom = '20px';
    infoBox.style.left = '50%';
    infoBox.style.transform = 'translateX(-50%)';
    infoBox.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    infoBox.style.color = 'white';
    infoBox.style.padding = '10px';
    infoBox.style.borderRadius = '5px';
    infoBox.style.fontSize = '16px';
    infoBox.style.width = '80%';
    infoBox.style.textAlign = 'center';
    // Insert line breaks for a neat layout.
    infoBox.innerHTML =
        'Lamp Crusher 2 is a fast-paced game where you control a lamp to crush falling letters.<br>' +
        'Use WASD to move, Space to jump, and your mouse to look around.<br>' +
        'Your objective is to stomp on letters to score points while managing your health, which decreases over time.<br>' +
        'Win by reaching the required points:<br>' +
        '- Easy Mode: 200 points<br>' +
        '- Normal Mode: 300 points<br>' +
        '- Hard Mode: 400 points<br>' +
        'Avoid running out of health to win the game!';
    document.body.appendChild(infoBox);

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

    // Create a container for score popups.
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

export function createModeSelectionMenu() {
    // Create a new menu for selecting the game mode.
    const modeMenu = document.createElement('div');
    modeMenu.id = 'modeMenu';
    modeMenu.style.position = 'absolute';
    modeMenu.style.top = '70%';
    modeMenu.style.left = '50%';
    modeMenu.style.transform = 'translate(-50%, -50%)';
    modeMenu.style.textAlign = 'center';
    modeMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    modeMenu.style.padding = '20px';
    modeMenu.style.borderRadius = '10px';
    modeMenu.style.zIndex = '9999';

    const modeTitle = document.createElement('h1');
    modeTitle.textContent = 'Select Mode';
    modeTitle.style.color = 'white';
    modeTitle.style.marginBottom = '20px';
    modeMenu.appendChild(modeTitle);

    // Easy Mode button.
    const easyButton = document.createElement('button');
    easyButton.textContent = 'Easy Mode';
    easyButton.style.padding = '10px 20px';
    easyButton.style.fontSize = '18px';
    easyButton.style.backgroundColor = '#4CAF50';
    easyButton.style.color = 'white';
    easyButton.style.border = 'none';
    easyButton.style.borderRadius = '5px';
    easyButton.style.cursor = 'pointer';
    easyButton.addEventListener('click', () => {
        if (window.startGame) {
            window.startGame('easy');
        }
        modeMenu.remove();  // Remove the mode menu after clicking.
        const infoBox = document.getElementById('infoBox');
        if(infoBox) infoBox.remove();
    });

    // Normal Mode button.
    const normalButton = document.createElement('button');
    normalButton.textContent = 'Normal Mode';
    normalButton.style.padding = '10px 20px';
    normalButton.style.fontSize = '18px';
    normalButton.style.backgroundColor = '#4CAF50';
    normalButton.style.color = 'white';
    normalButton.style.border = 'none';
    normalButton.style.borderRadius = '5px';
    normalButton.style.cursor = 'pointer';
    normalButton.style.marginLeft = '10px';
    normalButton.addEventListener('click', () => {
        if (window.startGame) {
            window.startGame('normal');
        }
        modeMenu.remove();  // Remove the mode menu after clicking.
        const infoBox = document.getElementById('infoBox');
        if(infoBox) infoBox.remove();
    });

    // Hard Mode button.
    const hardButton = document.createElement('button');
    hardButton.textContent = 'Hard Mode';
    hardButton.style.padding = '10px 20px';
    hardButton.style.fontSize = '18px';
    hardButton.style.backgroundColor = '#4CAF50';
    hardButton.style.color = 'white';
    hardButton.style.border = 'none';
    hardButton.style.borderRadius = '5px';
    hardButton.style.cursor = 'pointer';
    hardButton.style.marginLeft = '10px';
    hardButton.addEventListener('click', () => {
        if (window.startGame) {
            window.startGame('hard');
        }
        modeMenu.remove();  // Remove the mode menu after clicking.
        const infoBox = document.getElementById('infoBox');
        if(infoBox) infoBox.remove();
    });

    // Append mode buttons to the mode menu.
    modeMenu.appendChild(easyButton);
    modeMenu.appendChild(normalButton);
    modeMenu.appendChild(hardButton);
    document.body.appendChild(modeMenu);
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
