"use client";

import { ChangeEvent, memo, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import {
  CheckCircleIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/solid";
import { Tables } from "@/types/supabase";
import Text from "@/components/common/Text";
import TextArea from "@/components/common/TextArea";
import {
  checkInstagramContainerStatus,
  createInstagramCarouselContainer,
  createInstagramContainer,
  createSocialMediaPost,
  publishInstagramMediaContainer,
  saveInstagramId,
} from "@/app/actions/socialMediaPosts";
import Icons from "@/components/common/Icons";
import TextInput from "@/components/common/TextInput";
import { postVideoToYoutube } from "../actions/youtube";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import { useLogger } from "next-axiom";
import { errorString } from "@/utils/logging";
import { createClient } from "@/utils/supabase/client";

const bucketName =
  process.env.NEXT_PUBLIC_SOCIAL_MEDIA_POST_MEDIA_FILES_STORAGE_BUCKET;

const MemoizedMedia = memo(
  function Media({ file, onRemove }: { file: File; onRemove: () => void }) {
    return (
      <div className={"flex flex-col items-center gap-2 w-full"}>
        {file.type === "image/jpeg" ? (
          <img
            className="w-72 shadow-lg rounded-lg h-auto aspect-image my-8"
            src={URL.createObjectURL(file)}
            alt={file.name}
          />
        ) : (
          <video
            id="video"
            className="w-72 shadow-lg rounded-lg h-auto aspect-video my-8"
            src={URL.createObjectURL(file)}
            controls
          />
        )}
        <button onClick={onRemove}>
          <TrashIcon className="h-6 w-6 text-gray-400" />
        </button>
      </div>
    );
  },
  (prevProps, nextProps) => prevProps.file === nextProps.file
);

type ProcessingState = "processing" | "posted" | "error";

export default function VideoUploadComponent({
  instagramAccounts,
  youtubeChannels,
  userId,
}: {
  instagramAccounts: Tables<"instagram-accounts">[];
  youtubeChannels: Tables<"youtube-channels">[];
  userId: string;
}) {
  const [selectedInstagramAccounts, setSelectedInstagramAccounts] = useState<
    Tables<"instagram-accounts">[]
  >([]);
  const [selectedYoutubeChannels, setSelectedYoutubeChannels] = useState<
    Tables<"youtube-channels">[]
  >([]);
  const [files, setFiles] = useState<{ file: File; errorMessage: string }[]>(
    []
  );
  const [
    instagramAccountIdToProcessingState,
    setInstagramAccountIdToProcessingState,
  ] = useState<{
    [key: string]: ProcessingState;
  }>({});
  const [
    youtubeChannelIdToProcessingState,
    setYoutubeChannelIdToProcessingState,
  ] = useState<{
    [key: string]: ProcessingState;
  }>({});
  const [youtubeTitle, setYoutubeTitle] = useState<string>("");
  const [caption, setCaption] = useState<string>("");
  let logger = useLogger();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (fileInputRef.current?.files) {
      const files = fileInputRef.current?.files;
      for (let i = 0; i < files.length; i++) {
        const selectedFile = files[i];
        if (
          selectedFile.type === "video/mp4" ||
          selectedFile.type === "video/quicktime"
        ) {
          // Validate file size (1GB max)
          const maxSizeInBytes = 1024 * 1024 * 1024;
          if (selectedFile.size > maxSizeInBytes) {
            setFiles((prev) => [
              ...prev,
              {
                file: selectedFile,
                errorMessage: "File error: Video file size exceeds 1GB.",
              },
            ]);
            return;
          }

          // Validate file duration (3 seconds min, 15 minutes max)
          const video = document.createElement("video");
          video.preload = "metadata";
          video.onloadedmetadata = () => {
            window.URL.revokeObjectURL(video.src);
            const duration = video.duration;
            if (duration < 3 || duration > 15 * 60) {
              setFiles((prev) => [
                ...prev,
                {
                  file: selectedFile,
                  errorMessage:
                    "File error: Video duration must be between 3 seconds and 15 minutes.",
                },
              ]);
            } else {
              setFiles((prev) => [
                ...prev,
                { file: selectedFile, errorMessage: "" },
              ]);
            }
          };
          video.src = URL.createObjectURL(selectedFile);
        } else if (selectedFile.type === "image/jpeg") {
          // Validate file size (8MB max)
          const maxSizeInBytes = 1024 * 1024 * 8;
          if (selectedFile.size > maxSizeInBytes) {
            setFiles((prev) => [
              ...prev,
              {
                file: selectedFile,
                errorMessage: "File error: Image file size exceeds 9MB.",
              },
            ]);
            return;
          }
          setFiles((prev) => [
            ...prev,
            { file: selectedFile, errorMessage: "" },
          ]);
        }
      }
    }
  };

  const handleCustomButtonClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const processSocialMediaPost = () => {
    createSocialMediaPost(userId).then(async (socialMediaPostId) => {
      if (files.length === 1) {
        processSingleSocialMediaPost({ socialMediaPostId });
      } else if (files.length > 1) {
        processCarouselSocialMediaPost({ socialMediaPostId });
      }
    });
  };

  const uploadSocialMediaPostFile = async ({
    userId,
    file,
    index,
    postId,
  }: {
    userId: string;
    file: File;
    index: number;
    postId: string;
  }) => {
    logger = logger.with({
      function: "uploadSocialMediaPostFile",
      userId,
    });

    if (!bucketName) {
      logger.error(errorString, {
        error: "No bucket name found in environment variables",
      });
      await logger.flush();
      throw Error("Sorry, something went wrong. The team is looking into it.");
    }

    const filePath = `${userId}/${postId}/${index}.${
      file.name.split(".").pop() ?? file.name
    }`;

    // Upload file
    const { data: uploadResponse, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file, { upsert: true });
    if (uploadError) {
      logger.error(errorString, uploadError);
      throw Error(
        "Sorry, we had an issue uploading your file. Please try again."
      );
    }
    if (!uploadResponse?.path) {
      logger.error(errorString, {
        error: "No file path found in response from Supabase",
      });
      throw new Error("No file path found in response from Supabase");
    }

    const { error: insertError } = await supabase
      .from("social-media-post-media-files")
      .insert({
        media_file_path: uploadResponse.path,
        parent_social_media_post_id: postId,
        user_id: userId,
      });

    if (insertError) {
      logger.error(errorString, insertError);
      await logger.flush();
      throw Error(
        "Sorry, we had an issue uploading your file. Please try again."
      );
    }

    logger.info("Social media post file uploaded", { file: file.name });
    return uploadResponse.path;
  };

  const processCarouselSocialMediaPost = async ({
    socialMediaPostId,
  }: {
    socialMediaPostId: string;
  }) => {
    const filePaths = await Promise.all(
      files.map(async ({ file }, index) => {
        return {
          filePath: await uploadSocialMediaPostFile({
            userId,
            file,
            index,
            postId: socialMediaPostId,
          }),
          postType: file.type.includes("video") ? "video" : "image",
        };
      })
    );
    selectedInstagramAccounts.forEach(async (account) => {
      setInstagramAccountIdToProcessingState({
        [account.instagram_business_account_id]: "processing",
      });
      Promise.all(
        filePaths.map(({ filePath, postType }) =>
          createInstagramContainer({
            instagramBusinessAccountId: account.instagram_business_account_id,
            filePath,
            userId,
            postType: postType.includes("video") ? "video" : "image",
            isCarouselItem: true,
          })
        )
      )
        .then((instagramCarouselMediaContainerIds) =>
          checkInstagramContainerStatus({
            containerIds: instagramCarouselMediaContainerIds,
            instagramBusinessAccountId: account.instagram_business_account_id,
            userId,
          }).then(() =>
            createInstagramCarouselContainer({
              instagramCarouselMediaContainerIds,
              instagramBusinessAccountId: account.instagram_business_account_id,
              userId,
              caption,
            }).then((instagramMediaContainerId) =>
              checkInstagramContainerStatus({
                containerIds: [instagramMediaContainerId],
                instagramBusinessAccountId:
                  account.instagram_business_account_id,
                userId,
              }).then(() =>
                publishInstagramMediaContainer({
                  instagramBusinessAccountId:
                    account.instagram_business_account_id,
                  instagramMediaContainerId,
                  userId,
                }).then((instagramMediaId) => {
                  saveInstagramId({
                    instagramMediaId,
                    parentSocialMediaPostId: socialMediaPostId,
                    caption,
                    userId,
                  });
                  setInstagramAccountIdToProcessingState({
                    [account.instagram_business_account_id]: "posted",
                  });
                })
              )
            )
          )
        )
        .catch((err) => {
          setInstagramAccountIdToProcessingState({
            [account.instagram_business_account_id]: "error",
          });
        });
    });
  };

  const processSingleSocialMediaPost = async ({
    socialMediaPostId,
  }: {
    socialMediaPostId: string;
  }) => {
    const file = files[0].file;
    const filePath = await uploadSocialMediaPostFile({
      userId,
      file,
      index: 0,
      postId: socialMediaPostId,
    });
    selectedInstagramAccounts.forEach((account) => {
      setInstagramAccountIdToProcessingState({
        [account.instagram_business_account_id]: "processing",
      });
      createInstagramContainer({
        instagramBusinessAccountId: account.instagram_business_account_id,
        filePath,
        caption,
        userId,
        postType: file.type.includes("video") ? "video" : "image",
        isCarouselItem: false,
      })
        .then((containerId) =>
          checkInstagramContainerStatus({
            containerIds: [containerId],
            instagramBusinessAccountId: account.instagram_business_account_id,
            userId,
          }).then(() => {
            publishInstagramMediaContainer({
              instagramMediaContainerId: containerId,
              instagramBusinessAccountId: account.instagram_business_account_id,
              userId,
            }).then((instagramMediaId) => {
              saveInstagramId({
                instagramMediaId,
                parentSocialMediaPostId: socialMediaPostId,
                caption: caption ?? "",
                userId,
              });
              setInstagramAccountIdToProcessingState({
                [account.instagram_business_account_id]: "posted",
              });
            });
          })
        )
        .catch(() => {
          setInstagramAccountIdToProcessingState({
            [account.instagram_business_account_id]: "error",
          });
        });
    });
    selectedYoutubeChannels.forEach((channel) => {
      setYoutubeChannelIdToProcessingState({
        [channel.id]: "processing",
      });
      const formData = new FormData();
      formData.append("youtubeChannelId", channel.id);
      formData.append("video", file);
      formData.append("title", youtubeTitle);
      formData.append("userId", userId);
      formData.append("parentSocialMediaPostId", socialMediaPostId);
      fetch("/api/youtube/post", {
        method: "POST",
        body: formData,
      }).then((resp) => {
        if (resp.ok) {
          setYoutubeChannelIdToProcessingState({
            [channel.id]: "posted",
          });
        } else {
          setYoutubeChannelIdToProcessingState({
            [channel.id]: "error",
          });
        }
      });
    });
  };

  return (
    <div className={"flex flex-col justify-center items-center w-full px-2"}>
      <div
        className={
          "flex justify-center items-center gap-2 flex-wrap w-full mb-4"
        }
      >
        {files.map(({ file, errorMessage }) => (
          <div>
            <MemoizedMedia
              file={file}
              onRemove={() =>
                setFiles((prev) => prev.filter((entry) => entry.file !== file))
              }
            />
            {errorMessage && (
              <div
                className={"bg-red-500 rounded-lg p-4 flex items-center gap-2"}
              >
                <XCircleIcon className={"h-6 w-6"} />
                <p className={""}>{errorMessage} </p>
              </div>
            )}
          </div>
        ))}
      </div>
      {files.length === 0 && (
        <div
          className="mb-4 border-2 border-gray-200 hover:border-orange-500 hover:cursor-pointer w-full md:w-1/2 h-48 rounded-lg flex items-center justify-center"
          onClick={handleCustomButtonClick}
        >
          <p className="text-gray-400">Click to add photos or videos</p>
        </div>
      )}
      <div className={"flex flex-col justify-center w-full md:w-1/2"}>
        <div className={"flex flex-wrap justify-center items-center gap-2"}>
          {instagramAccounts.map((account) => (
            <button
              className={`p-4 rounded-lg bg-gray-800 flex flex-col items-center gap-2 ${
                selectedInstagramAccounts.find(
                  (acc) =>
                    acc.instagram_business_account_id ===
                    account.instagram_business_account_id
                ) && "border-2 border-orange-500"
              }`}
              onClick={() =>
                setSelectedInstagramAccounts((prev) => {
                  if (
                    prev.find(
                      (acc) => acc.id === account.instagram_business_account_id
                    )
                  ) {
                    return prev.filter(
                      (acc) => acc.id !== account.instagram_business_account_id
                    );
                  }
                  return [...prev, account];
                })
              }
              key={account.instagram_business_account_id}
            >
              <div className="flex items-center gap-2">
                <div className="relative w-8 h-8">
                  <img
                    src={account.picture_url}
                    alt={account.account_name}
                    className="w-8 h-8 rounded-full"
                  />
                  <Icons.instagram className="absolute bottom-[-8px] right-[-8px] w-6 h-6 rounded-full" />
                </div>
                <Text text={account.account_name} />
              </div>
              <div className="text-sm mt-1 flex items-center gap-2 justify-between w-full">
                <p
                  className={`
                  ${
                    instagramAccountIdToProcessingState[
                      account.instagram_business_account_id
                    ] === "posted" && "text-green-400"
                  }
                  ${
                    instagramAccountIdToProcessingState[
                      account.instagram_business_account_id
                    ] === "error" && "text-red-400"
                  }
                  ${
                    instagramAccountIdToProcessingState[
                      account.instagram_business_account_id
                    ] === "processing" && "text-orange-400"
                  }
                `}
                >
                  {
                    instagramAccountIdToProcessingState[
                      account.instagram_business_account_id
                    ]
                  }
                </p>
                {instagramAccountIdToProcessingState[
                  account.instagram_business_account_id
                ] === "processing" && <LoadingSpinner size="h-6 w-6" />}
                {instagramAccountIdToProcessingState[
                  account.instagram_business_account_id
                ] === "error" && (
                  <XCircleIcon className="h-6 w-6 text-red-400" />
                )}
                {instagramAccountIdToProcessingState[
                  account.instagram_business_account_id
                ] === "posted" && (
                  <CheckCircleIcon className="h-6 w-6 text-green-400" />
                )}
              </div>
            </button>
          ))}
          {youtubeChannels.map((channel) => (
            <button
              className={`p-4 rounded-lg bg-gray-800 flex flex-col items-center gap-2 ${
                selectedYoutubeChannels.find((ch) => ch.id === channel.id) &&
                "border-2 border-orange-500"
              }`}
              onClick={() =>
                setSelectedYoutubeChannels((prev) => {
                  if (prev.find((acc) => acc.id === channel.id)) {
                    return prev.filter((acc) => acc.id !== channel.id);
                  }
                  return [...prev, channel];
                })
              }
              key={channel.id}
            >
              <div className="flex items-center gap-2">
                <div className="relative w-8 h-8">
                  <img
                    src={channel.profile_picture_path}
                    alt={channel.channel_custom_url}
                    className="w-8 h-8 rounded-full"
                  />
                  <Icons.youtube className="absolute bottom-[-8px] right-[-8px] w-6 h-6 rounded-full" />
                </div>
                <Text text={channel.channel_custom_url} />
              </div>
              <div className="text-sm mt-1 flex items-center gap-2 justify-between w-full">
                <p
                  className={`
                  ${
                    youtubeChannelIdToProcessingState[channel.id] ===
                      "posted" && "text-green-400"
                  }
                  ${
                    youtubeChannelIdToProcessingState[channel.id] === "error" &&
                    "text-red-400"
                  }
                  ${
                    youtubeChannelIdToProcessingState[channel.id] ===
                      "processing" && "text-orange-400"
                  }
                `}
                >
                  {youtubeChannelIdToProcessingState[channel.id]}
                </p>
                {youtubeChannelIdToProcessingState[channel.id] ===
                  "processing" && <LoadingSpinner size="h-6 w-6" />}
                {youtubeChannelIdToProcessingState[channel.id] === "error" && (
                  <XCircleIcon className="h-6 w-6 text-red-400" />
                )}
                {youtubeChannelIdToProcessingState[channel.id] === "posted" && (
                  <CheckCircleIcon className="h-6 w-6 text-green-400" />
                )}
              </div>
            </button>
          ))}
        </div>
        <form
          action={processSocialMediaPost}
          className={"flex flex-col justify-center"}
        >
          <input type={"hidden"} name={"userId"} value={userId} />
          <input
            type="file"
            onChange={handleFileChange}
            style={{ display: "none" }}
            className={"hidden"}
            ref={fileInputRef}
            multiple
            name={"mediaFiles"}
            accept="video/mp4, video/quicktime, image/jpeg"
          />
          <input type={"hidden"} name={"numberOfFiles"} value={files.length} />
          {selectedInstagramAccounts.length > 0 && (
            <TextArea
              title={"Caption"}
              name={"caption"}
              placeholder={
                "Check out thecontentmarketingblueprint.com for help with social media marketing!"
              }
              value={caption}
              setValue={setCaption}
            />
          )}
          {selectedYoutubeChannels.length > 0 && (
            <TextInput
              name={"youtubeTitle"}
              title={"Youtube Title"}
              placeholder={
                "Check out thecontentmarketingblueprint.com for help with social media marketing!"
              }
              required={true}
              maxLength={100}
              type={"text"}
              value={youtubeTitle}
              setValue={setYoutubeTitle}
            />
          )}
          <Button
            disabled={
              (selectedInstagramAccounts.length === 0 &&
                selectedYoutubeChannels.length === 0) ||
              files.length === 0 ||
              files.some((entry) => entry.errorMessage) ||
              (selectedYoutubeChannels.length > 0 &&
                youtubeTitle.length === 0) ||
              (selectedYoutubeChannels.length > 0 &&
                youtubeTitle.length > 100) ||
              Object.values(instagramAccountIdToProcessingState).some(
                (state) => state === "processing"
              ) ||
              Object.values(youtubeChannelIdToProcessingState).some(
                (state) => state === "processing"
              )
            }
            type={"submit"}
          >
            Upload Post
          </Button>
        </form>
      </div>
    </div>
  );
}
