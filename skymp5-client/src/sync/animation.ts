/* eslint-disable @typescript-eslint/no-empty-function */
import {
  ObjectReference,
  Debug,
  hooks,
  Actor,
  printConsole,
  Utility,
  Game,
  storage,
  // @ts-expect-error (TODO: Remove in 2.10.0)
  setCollision
} from "skyrimPlatform";
import { Movement } from "./movement";
import { applyWeapDrawn } from "./movementApply";

export enum AnimationEventName {
  Ragdoll = "Ragdoll",
  GetUpBegin = "GetUpBegin",
};

export interface Animation {
  animEventName: string;
  numChanges: number;
}

export interface AnimationApplyState {
  lastNumChanges: number;
}

const allowedIdles = new Array<[number, string]>();
const refsWithDefaultAnimsDisabled = new Set<number>();
const allowedAnims = new Set<string>();

const actorSitAnimsLowerCase = [
  "IdleStoolEnterPlayer",
  "IdleStoolEnter",
  "IdleStoolEnterInstant",
  "IdleChairRightEnter",
  "IdleChairLeftEnter",
  "IdleChairFrontEnter",
  "IdleJarlChairEnter",
  "IdleJarlChairEnterInstant",
  "IdleSnowElfPrinceChairDialogue",
  "IdleSnowElfPrinceChairEnter",
  "IdleSnowElfPrinceChairEnterInstant",
  "IdleChairCHILDEnterInstant",
  "IdleChairCHILDFrontEnter",
  "IdleChairCHILDLeftEnter",
  "IdleChairCHILDRightEnter",
  "IdleChairEnterInstant",
].map(x => x.toLowerCase());

const actorGetUpAnimsLowerCase = [
  "IdleStoolBackExit",
  "IdleChairRightExit",
  "IdleChairRightQuickExit",
  "IdleChairLeftExit",
  "IdleChairLeftQuickExit",
  "IdleChairFrontExit",
  "IdleChairFrontQuickExit",
  "IdleChairCHILDFrontExit",
  "IdleChairCHILDLeftExit",
  "IdleChairCHILDRightExit",
].map(x => x.toLocaleLowerCase());

// unclassified:

// IdleChairEnterInstant
// IdleChairEnterStart
// IdleChairEnterStop
// IdleChairEnterToSit
// IdleChairExitStart
// IdleChairExitToStand
// IdleChairSitting
// IdleLeftChairEnterStart
// ChairIdle
// IdleRightChairEnterStart
// IdleLeftChairEnterStart

const isIdle = (animEventName: string) => {
  return (
    animEventName === "MotionDrivenIdle" ||
    (animEventName.startsWith("Idle") &&
      animEventName !== "IdleStop" &&
      animEventName !== "IdleForceDefaultState")
  );
};

export const applyAnimation = (
  refr: ObjectReference,
  anim: Animation,
  state: AnimationApplyState
): void => {
  if (state.lastNumChanges === anim.numChanges) return;
  state.lastNumChanges = anim.numChanges;

  if (isIdle(anim.animEventName)) {
    allowedIdles.push([refr.getFormID(), anim.animEventName]);
  }

  const ac = Actor.from(refr);

  if (anim.animEventName === "SkympFakeEquip") {
    if (ac) applyWeapDrawn(ac, true);
    return;
  }

  if (anim.animEventName === "SkympFakeUnequip") {
    if (ac) applyWeapDrawn(ac, false);
    return;
  }

  if (anim.animEventName === "Ragdoll") {
    if (ac) {
      if (storage["animationFunc1Set"] === true) {
        // @ts-ignore
        storage["animationFunc1"](ac);
      }
      else {
        ac.pushActorAway(ac, 0);
        ac.setActorValue("Variable10", -1000);
      }
    }
    return;
  }

  const animEventNameLowerCase = anim.animEventName.toLowerCase();

  if (refsWithDefaultAnimsDisabled.has(refr.getFormID())) {
    if (animEventNameLowerCase.includes("attack")) {
      allowedAnims.add(refr.getFormID() + ":" + anim.animEventName);
    }
  }

  Debug.sendAnimationEvent(refr, anim.animEventName);

  if (anim.animEventName === "GetUpBegin") {
    const refrId = refr.getFormID();
    Utility.wait(1).then(() => {
      const ac = Actor.from(Game.getFormEx(refrId));
      if (ac) ac.setActorValue("Variable10", 1000);
    });
  }

  if (actorSitAnimsLowerCase.find((x) => x === animEventNameLowerCase) !== undefined) {
    setCollision(refr.getFormID(), false);
  }

  if (actorGetUpAnimsLowerCase.find((x) => x === animEventNameLowerCase) !== undefined) {
    setCollision(refr.getFormID(), true);
  }
};

export const setDefaultAnimsDisabled = (
  refrId: number,
  disabled: boolean
): void => {
  if (disabled) refsWithDefaultAnimsDisabled.add(refrId);
  else refsWithDefaultAnimsDisabled.delete(refrId);
};

export class AnimationSource {
  constructor(refr: ObjectReference) {
    this.refrId = refr.getFormID();
    hooks.sendAnimationEvent.add({
      enter: () => { },
      leave: (ctx) => {
        if (ctx.selfId !== this.refrId) {
          return;
        }

        if (!ctx.animationSucceeded) {
          // Workaround, see carryAnimSystem.ts in gamemode
          // Case-sensetive check here for better performance
          if (ctx.animEventName !== "OffsetCarryBasketStart") {
            return;
          }
        }
        this.onSendAnimationEvent(ctx.animEventName);
      },
    });
  }

  filterMovement(mov: Movement): Movement {
    if (this.weapDrawnBlocker >= Date.now()) mov.isWeapDrawn = true;
    if (this.weapNonDrawnBlocker >= Date.now()) mov.isWeapDrawn = false;

    if (this.sneakBlocker === mov.isSneaking) this.sneakBlocker = null;
    else if (this.sneakBlocker === true) mov.isSneaking = true;
    else if (this.sneakBlocker === false) mov.isSneaking = false;

    return mov;
  }

  getAnimation(): Animation {
    const { numChanges, animEventName } = this;
    return { numChanges, animEventName };
  }

  private onSendAnimationEvent(animEventName: string) {
    if (ignoredAnims.has(animEventName)) return;

    const lower = animEventName.toLowerCase();

    const isTorchEvent = lower.includes("torch");
    if (animEventName.toLowerCase().includes("unequip") && !isTorchEvent) {
      this.weapNonDrawnBlocker = Date.now() + 300;
      animEventName = "SkympFakeUnequip";
    } else if (animEventName.toLowerCase().includes("equip") && !isTorchEvent) {
      this.weapDrawnBlocker = Date.now() + 300;
      animEventName = "SkympFakeEquip";
    }

    if (animEventName === "SneakStart") {
      this.sneakBlocker = true;
      return;
    }
    if (animEventName === "SneakStop") {
      this.sneakBlocker = false;
      return;
    }

    this.numChanges++;
    this.animEventName = animEventName;
  }

  private refrId = 0;
  private numChanges = 0;
  private animEventName = "";

  private weapNonDrawnBlocker = 0;
  private weapDrawnBlocker = 0;
  private sneakBlocker: boolean | null = null;
}

const ignoredAnims = new Set<string>([
  "moveStart",
  "moveStop",
  "turnStop",
  "CyclicCrossBlend",
  "CyclicFreeze",
  "TurnLeft",
  "TurnRight",
]);

export const setupHooks = (): void => {
  hooks.sendAnimationEvent.add({
    enter: (ctx) => {
      if (refsWithDefaultAnimsDisabled.has(ctx.selfId)) {
        if (ctx.animEventName.toLowerCase().includes("attack")) {
          const animKey = ctx.selfId + ":" + ctx.animEventName;
          if (allowedAnims.has(animKey)) {
            allowedAnims.delete(animKey);
          } else {
            printConsole("block anim " + ctx.animEventName);
            return (ctx.animEventName = "");
          }
        }
      }

      // ShowRaceMenu forces this anim
      if (ctx.animEventName === "OffsetBoundStandingPlayerInstant") {
        return (ctx.animEventName = "");
      }

      // Disable idle animations for 0xff actors
      if (ctx.selfId < 0xff000000) return;
      if (isIdle(ctx.animEventName)) {
        const i = allowedIdles.findIndex((pair) => {
          return pair[0] === ctx.selfId && pair[1] === ctx.animEventName;
        });
        i === -1 ? (ctx.animEventName = "") : allowedIdles.splice(i, 1);
      }
    },
    leave: () => { },
  });
};
