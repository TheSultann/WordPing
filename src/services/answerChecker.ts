import { CardDirection } from '../generated/prisma';
import { answersEqual, answersEqualEnglish } from '../utils/text';

export type AnswerCheckResult = {
  correct: boolean;
  normalizedExpected: string;
};

export const checkAnswer = (
  direction: CardDirection,
  expectedEn: string,
  expectedRu: string,
  userAnswer: string
): AnswerCheckResult => {
  if (direction === 'RU_TO_EN') {
    const correct = answersEqualEnglish(expectedEn, userAnswer);
    return { correct, normalizedExpected: expectedEn };
  }
  // EN_TO_RU
  const correct = answersEqual(expectedRu, userAnswer);
  return { correct, normalizedExpected: expectedRu };
};
