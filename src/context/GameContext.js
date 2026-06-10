import React, { createContext, useState, useContext } from 'react';

const GameContext = createContext();

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};

export const GameProvider = ({ children }) => {
  const [players, setPlayers] = useState([]);
  const [numRounds, setNumRounds] = useState(3);
  const [timeLimit, setTimeLimit] = useState(60);
  const [currentRound, setCurrentRound] = useState(1);
  const [roundScores, setRoundScores] = useState([]);
  const [currentTopic, setCurrentTopic] = useState('');

  const resetGame = () => {
    setPlayers([]);
    setNumRounds(3);
    setTimeLimit(60);
    setCurrentRound(1);
    setRoundScores([]);
    setCurrentTopic('');
  };

  const addPlayer = (name) => {
    setPlayers((prev) => [...prev, { name, totalScore: 0 }]);
  };

  const removePlayer = (index) => {
    setPlayers((prev) => prev.filter((_, i) => i !== index));
  };

  const submitRoundScores = (scores) => {
    // scores is an array of {playerIndex, score}
    const newRoundScores = [...roundScores];
    newRoundScores[currentRound - 1] = scores;
    setRoundScores(newRoundScores);

    // Update total scores
    const updatedPlayers = players.map((player, index) => {
      const playerScore = scores.find((s) => s.playerIndex === index);
      return {
        ...player,
        totalScore: player.totalScore + (playerScore?.score || 0),
      };
    });
    setPlayers(updatedPlayers);
  };

  const nextRound = () => {
    setCurrentRound((prev) => prev + 1);
  };

  const value = {
    players,
    setPlayers,
    numRounds,
    setNumRounds,
    timeLimit,
    setTimeLimit,
    currentRound,
    setCurrentRound,
    roundScores,
    currentTopic,
    setCurrentTopic,
    resetGame,
    addPlayer,
    removePlayer,
    submitRoundScores,
    nextRound,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};
