import { CosmereCombat, CosmereTokenDocument } from '.';
import { TokenInStageFunc, RoundStageConfig } from '../types/config';
import { ActorType, TurnSpeed } from '../types/cosmere';
import { CosmereCombatant } from './combatant';

export class RoundStage implements RoundStageConfig {
    stageName: string;
    stageSpeed?: TurnSpeed;
    stageActorType?: ActorType;
    tokenInStageFunc?: TokenInStageFunc;
    participants: CosmereCombatant[] = [];

    constructor(stageConfig: RoundStageConfig) {
        this.stageName = stageConfig.stageName;
        this.stageSpeed = stageConfig.stageSpeed;
        this.stageActorType = stageConfig.stageActorType;
        this.tokenInStageFunc = stageConfig.tokenInStageFunc;
    }

    static getInitialStages() {
        const stages = {} as Record<string, RoundStage>;
        for (const stage of CONFIG.COSMERE.combat.stages) {
            stages[stage.stageName] = new RoundStage(stage);
        }
        return stages;
    }

    private activeParticipant: CosmereCombatant | undefined;

    get currentParticipant() {
        return this.activeParticipant ?? this.participants[0];
    }
    set currentParticipant(combatant) {
        if (this.participants.includes(combatant)) {
            this.activeParticipant = combatant;
        }
    }

    get populated(): boolean {
        return this.participants.length > 0;
    }

    async missingParticipants(
        combatants: CosmereCombatant[],
    ): Promise<
        | {
              sourceCombatant: CosmereCombatant;
              createData: Combatant.CreateData;
          }[]
        | void
    > {
        await Promise.resolve();
        if (!this.tokenInStageFunc) {
            return;
        }
        const missingParticipantsArray: {
            sourceCombatant: CosmereCombatant;
            createData: Combatant.CreateData;
        }[] = [];
        const possibleValidParticipants = combatants.filter(
            async (combatant) => {
                if (this.tokenInStageFunc) {
                    return await this.tokenInStageFunc(combatant.token!);
                } else return false;
            },
        );
        for (const participant of possibleValidParticipants) {
            if (!this.tokenIsInRound(participant.token!)) {
                const createData: Combatant.CreateData = {
                    tokenId: participant.tokenId,
                    sceneId: participant.sceneId,
                    actorId: participant.actorId,
                    hidden: participant.hidden,
                    system: {
                        forcedRoundStage: this.stageName,
                    },
                };
                missingParticipantsArray.push({
                    sourceCombatant: participant,
                    createData,
                });
            }
        }
        if (missingParticipantsArray.length == 0) {
            return;
        } else {
            return missingParticipantsArray;
        }
    }

    tokenIsInRound(token: CosmereTokenDocument) {
        for (const turn of this.participants) {
            if (turn.tokenId === token.id) {
                return true;
            }
        }
        return false;
    }

    updateParticipants(combatants: CosmereCombatant[]) {
        this.participants = combatants.filter((combatant) => {
            if (combatant.system.forcedRoundStage) {
                return combatant.system.forcedRoundStage === this.stageName;
            }
            return (
                combatant.turnSpeed === this.stageSpeed &&
                combatant.actor.type === this.stageActorType
            );
        });
    }
}
