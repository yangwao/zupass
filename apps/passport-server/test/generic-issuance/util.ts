import { EdDSATicketPCD, EdDSATicketPCDPackage } from "@pcd/eddsa-ticket-pcd";
import { EmailPCDPackage } from "@pcd/email-pcd";
import {
  FeedCredentialPayload,
  InfoResult,
  PodboxTicketActionResult,
  PollFeedResult,
  createFeedCredentialPayload,
  createTicketActionCredentialPayload,
  requestPipelineInfo,
  requestPodboxTicketAction,
  requestPollFeed
} from "@pcd/passport-interface";
import { expectIsReplaceInFolderAction } from "@pcd/pcd-collection";
import { ArgumentTypeName, SerializedPCD } from "@pcd/pcd-types";
import { SemaphoreIdentityPCDPackage } from "@pcd/semaphore-identity-pcd";
import {
  SemaphoreSignaturePCD,
  SemaphoreSignaturePCDPackage
} from "@pcd/semaphore-signature-pcd";
import { Identity } from "@semaphore-protocol/identity";
import { expect } from "chai";
import {
  Pipeline,
  PipelineUser
} from "../../src/services/generic-issuance/pipelines/types";
import { Zupass } from "../../src/types";
import { expectFalse, expectTrue } from "../util/util";

/**
 * Testing that the Generic Issuance backend calculates {@link InfoResult} about
 * pipeline {@link PretixPipeline} correctly by requesting it from the Generic
 * Issuance API routes.
 *
 * This endpoint is used by the Generic Issuance frontend to assist a user in
 * managing their {@link Pipeline}.
 *
 * TODO: incorporate auth
 */
export async function checkPipelineInfoEndpoint(
  giBackend: Zupass,
  pipeline: Pipeline
): Promise<void> {
  const pipelineInfoResult: InfoResult = await requestPipelineInfo(
    "todo",
    giBackend.expressContext.localEndpoint,
    pipeline.id
  );
  expectFalse(pipelineInfoResult.success);
}

export function assertUserMatches(
  expectedUser: PipelineUser,
  actualUser: PipelineUser | undefined
): void {
  expect(actualUser).to.exist;
  expect(actualUser?.email).to.eq(expectedUser.email);
  expect(actualUser?.id).to.eq(expectedUser.id);
  expect(actualUser?.isAdmin).to.eq(expectedUser.isAdmin);
}

/**
 * Receivers of {@link EdDSATicketPCD} can 'check in' other holders of
 * tickets issued by the same feed, if their ticket's 'product type' has
 * been configured by the owner of the pipeline of this feed.
 */
export async function requestCheckInPipelineTicket(
  /**
   * {@link Pipeline}s can have a {@link CheckinCapability}
   */
  checkinRoute: string,
  zupassEddsaPrivateKey: string,
  checkerEmail: string,
  checkerIdentity: Identity,
  ticket: EdDSATicketPCD
): Promise<PodboxTicketActionResult> {
  const checkerEmailPCD = await EmailPCDPackage.prove({
    privateKey: {
      value: zupassEddsaPrivateKey,
      argumentType: ArgumentTypeName.String
    },
    id: {
      value: "email-id",
      argumentType: ArgumentTypeName.String
    },
    emailAddress: {
      value: checkerEmail,
      argumentType: ArgumentTypeName.String
    },
    semaphoreId: {
      value: checkerIdentity.commitment.toString(),
      argumentType: ArgumentTypeName.String
    }
  });
  const serializedTicketCheckerEmailPCD =
    await EmailPCDPackage.serialize(checkerEmailPCD);

  const ticketCheckerPayload = createTicketActionCredentialPayload(
    serializedTicketCheckerEmailPCD,
    {
      checkin: true
    },
    ticket.claim.ticket.eventId,
    ticket.claim.ticket.ticketId
  );

  const ticketCheckerFeedCredential = await signFeedCredentialPayload(
    checkerIdentity,
    ticketCheckerPayload
  );

  return requestPodboxTicketAction(checkinRoute, ticketCheckerFeedCredential);
}

/**
 * Extracts tickets from {@link PollFeedResult}. Expects tickets to be returned
 * in a single {@link ReplaceInFolderAction}. Checks that the first and only
 * {@link PCDAction}
 */
export function getTicketsFromFeedResponse(
  expectedFolder: string,
  result: PollFeedResult
): Promise<EdDSATicketPCD[]> {
  expectTrue(result.success);
  const secondAction = result.value.actions[1];
  expectIsReplaceInFolderAction(secondAction);
  expect(secondAction.folder).to.eq(expectedFolder);
  return Promise.all(
    secondAction.pcds.map((t) => EdDSATicketPCDPackage.deserialize(t.pcd))
  );
}

/**
 * Requests tickets from a pipeline that is issuing {@link EdDSATicketPCD}s.
 */
export async function requestTicketsFromPipeline(
  expectedFolder: string,
  /**
   * Generated by {@code makeGenericIssuanceFeedUrl}.
   */
  feedUrl: string,
  feedId: string,
  /**
   * Rather than get an {@link EmailPCD} issued by the email feed
   * Zupass Server hosts, for testing purposes, we're generating
   * the email PCD on the fly inside this function using this key.
   */
  zupassEddsaPrivateKey: string,
  /**
   * Zupass Server attests that the given email address...
   */
  email: string,
  /**
   * Is owned by this identity.
   */
  identity: Identity
): Promise<EdDSATicketPCD[]> {
  const ticketPCDResponse = await requestPollFeed(feedUrl, {
    feedId: feedId,
    pcd: await signFeedCredentialPayload(
      identity,
      createFeedCredentialPayload(
        await EmailPCDPackage.serialize(
          await EmailPCDPackage.prove({
            privateKey: {
              value: zupassEddsaPrivateKey,
              argumentType: ArgumentTypeName.String
            },
            id: {
              value: "email-id",
              argumentType: ArgumentTypeName.String
            },
            emailAddress: {
              value: email,
              argumentType: ArgumentTypeName.String
            },
            semaphoreId: {
              value: identity.commitment.toString(),
              argumentType: ArgumentTypeName.String
            }
          })
        )
      )
    )
  });

  return getTicketsFromFeedResponse(expectedFolder, ticketPCDResponse);
}

/**
 * TODO: extract this to the `@pcd/passport-interface` package.
 */
export async function signFeedCredentialPayload(
  identity: Identity,
  payload: FeedCredentialPayload
): Promise<SerializedPCD<SemaphoreSignaturePCD>> {
  const signaturePCD = await SemaphoreSignaturePCDPackage.prove({
    identity: {
      argumentType: ArgumentTypeName.PCD,
      value: await SemaphoreIdentityPCDPackage.serialize(
        await SemaphoreIdentityPCDPackage.prove({
          identity: identity
        })
      )
    },
    signedMessage: {
      argumentType: ArgumentTypeName.String,
      value: JSON.stringify(payload)
    }
  });

  return await SemaphoreSignaturePCDPackage.serialize(signaturePCD);
}
