import { observer } from "mobx-react-lite";
import { BlinkoStore } from '@/store/blinkoStore';
import { Divider, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button } from '@nextui-org/react';
import { _ } from '@/lib/lodash';
import { useTranslation } from 'react-i18next';
import { ContextMenu, ContextMenuItem } from '@/components/Common/ContextMenu';
import { Icon } from '@iconify/react';
import { PromiseCall } from '@/store/standard/PromiseState';
import { api } from '@/lib/trpc';
import { RootStore } from "@/store";
import { DialogStore } from "@/store/module/Dialog";
import { BlinkoEditor } from "../BlinkoEditor";
import { useEffect, useState } from "react";
import { NoteType } from "@/server/types";
import { useRouter } from "next/router";
import { AiStore } from "@/store/aiStore";
import { FocusEditorFixMobile } from "../Common/Editor/editorUtils";

export const ShowEditBlinkoModel = (size: string = '2xl', mode: 'create' | 'edit' = 'edit') => {
  const blinko = RootStore.Get(BlinkoStore)
  RootStore.Get(DialogStore).setData({
    size: size as any,
    isOpen: true,
    onlyContent: true,
    isDismissable: false,
    showOnlyContentCloseButton: true,
    content: <BlinkoEditor mode={mode} key={`editor-key-${mode}`} onSended={() => {
      RootStore.Get(DialogStore).close()
      blinko.isCreateMode = false
    }} />
  })
}

const handleEdit = (isDetailPage: boolean) => {
  ShowEditBlinkoModel(isDetailPage ? '5xl' : '5xl')
  FocusEditorFixMobile()
}

const handleMultiSelect = () => {
  const blinko = RootStore.Get(BlinkoStore)
  blinko.isMultiSelectMode = true
  blinko.onMultiSelectNote(blinko.curSelectedNote?.id!)
}

const handleTop = () => {
  const blinko = RootStore.Get(BlinkoStore)
  blinko.upsertNote.call({
    id: blinko.curSelectedNote?.id,
    isTop: !blinko.curSelectedNote?.isTop
  })
}

const handlePublic = () => {
  const blinko = RootStore.Get(BlinkoStore)
  blinko.upsertNote.call({
    id: blinko.curSelectedNote?.id,
    isShare: !blinko.curSelectedNote?.isShare
  })
}

const handleArchived = () => {
  const blinko = RootStore.Get(BlinkoStore)
  if (blinko.curSelectedNote?.isRecycle) {
    return blinko.upsertNote.call({
      id: blinko.curSelectedNote?.id,
      isRecycle: false,
      isArchived: false
    })
  }

  if (blinko.curSelectedNote?.isArchived) {
    return blinko.upsertNote.call({
      id: blinko.curSelectedNote?.id,
      isArchived: false,
    })
  }

  if (!blinko.curSelectedNote?.isArchived) {
    return blinko.upsertNote.call({
      id: blinko.curSelectedNote?.id,
      isArchived: true
    })
  }
}

const handleAITag = () => {
  const blinko = RootStore.Get(BlinkoStore)
  const aiStore = RootStore.Get(AiStore)
  aiStore.autoTag.call(blinko.curSelectedNote?.id!, blinko.curSelectedNote?.content!)
}

const handleTrash = () => {
  const blinko = RootStore.Get(BlinkoStore)
  PromiseCall(api.notes.trashMany.mutate({ ids: [blinko.curSelectedNote?.id!] }))
}

const handleDelete = async () => {
  const blinko = RootStore.Get(BlinkoStore)
  PromiseCall(api.notes.deleteMany.mutate({ ids: [blinko.curSelectedNote?.id!] }))
  api.ai.embeddingDelete.mutate({ id: blinko.curSelectedNote?.id! })
}

export const EditItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2">
    <Icon icon="tabler:edit" width="20" height="20" />
    <div>{t('edit')}</div>
  </div>
})

export const MutiSelectItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2" >
    <Icon icon="mingcute:multiselect-line" width="20" height="20" />
    <div>{t('multiple-select')}</div>
  </div>
})

export const ConvertItemFunction = () => {
  const blinko = RootStore.Get(BlinkoStore)
  blinko.upsertNote.call({
    id: blinko.curSelectedNote?.id,
    type: blinko.curSelectedNote?.type == NoteType.NOTE ? NoteType.BLINKO : NoteType.NOTE
  })
}

export const ConvertItem = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore)
  return <div className="flex items-start gap-2">
    <Icon icon="ri:exchange-2-line" width="20" height="20" />
    <div>{t('convert-to')} {blinko.curSelectedNote?.type == NoteType.NOTE ?
      <span className='text-yellow-500'>{t('blinko')}</span> : <span className='text-blue-500'>{t('note')}</span>}</div>
  </div>
})

export const TopItem = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore)
  return <div className="flex items-start gap-2">
    <Icon icon="lets-icons:pin" width="20" height="20" />
    <div>{blinko.curSelectedNote?.isTop ? t('cancel-top') : t('top')}</div>
  </div>
})

export const PublicItem = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore)
  return <div className="flex items-start gap-2">
    <Icon icon="ic:outline-share" width="20" height="20" />
    <div>{blinko.curSelectedNote?.isShare ? t('unset-as-public') : t('set-as-public')}</div>
  </div>
})

export const ArchivedItem = observer(() => {
  const { t } = useTranslation();
  const blinko = RootStore.Get(BlinkoStore)
  return <div className="flex items-start gap-2">
    <Icon icon="eva:archive-outline" width="20" height="20" />
    {blinko.curSelectedNote?.isArchived || blinko.curSelectedNote?.isRecycle ? t('recovery') : t('archive')}
  </div>
})

export const AITagItem = observer(() => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <Icon icon="majesticons:tag-line" width="20" height="20" />
      <div>{t('ai-tag')}</div>
    </div>
  );
});

export const TrashItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2 text-red-500">
    <Icon icon="mingcute:delete-2-line" width="20" height="20" />
    <div>{t('trash')}</div>
  </div>
})

export const DeleteItem = observer(() => {
  const { t } = useTranslation();
  return <div className="flex items-start gap-2 text-red-500">
    <Icon icon="mingcute:delete-2-line" width="20" height="20" />
    <div>{t('delete')}</div>
  </div>
})

export const BlinkoRightClickMenu = observer(() => {
  const [isDetailPage, setIsDetailPage] = useState(false)
  const router = useRouter()
  const blinko = RootStore.Get(BlinkoStore)

  useEffect(() => {
    setIsDetailPage(router.pathname.includes('/detail'))
  }, [router.pathname])

  return <ContextMenu className='font-bold' id="blink-item-context-menu" hideOnLeave={false} animation="zoom">
    <ContextMenuItem onClick={() => handleEdit(isDetailPage)}>
      <EditItem />
    </ContextMenuItem>

    {!isDetailPage ? <ContextMenuItem onClick={() => handleMultiSelect()}>
      <MutiSelectItem />
    </ContextMenuItem> : <></>}

    <ContextMenuItem onClick={ConvertItemFunction}>
      <ConvertItem />
    </ContextMenuItem>

    <ContextMenuItem onClick={handleTop}>
      <TopItem />
    </ContextMenuItem>

    <ContextMenuItem onClick={handlePublic}>
      <PublicItem />
    </ContextMenuItem>

    <ContextMenuItem onClick={handleArchived}>
      <ArchivedItem />
    </ContextMenuItem>

    {blinko.config.value?.isUseAI ? (
      <ContextMenuItem onClick={handleAITag}>
        <AITagItem />
      </ContextMenuItem>
    ) : <></>}

    <ContextMenuItem className='select-none divider hover:!bg-none'>
      <Divider orientation="horizontal" />
    </ContextMenuItem>

    {!blinko.curSelectedNote?.isRecycle ? (
      <ContextMenuItem onClick={handleTrash}>
        <TrashItem />
      </ContextMenuItem>
    ) : <></>}

    {blinko.curSelectedNote?.isRecycle ? (
      <ContextMenuItem onClick={handleDelete}>
        <DeleteItem />
      </ContextMenuItem>
    ) : <></>}
  </ContextMenu>
})

export const LeftCickMenu = observer(({ onTrigger, className }: { onTrigger: () => void, className: string }) => {
  const [isDetailPage, setIsDetailPage] = useState(false)
  const router = useRouter()
  const blinko = RootStore.Get(BlinkoStore)

  useEffect(() => {
    setIsDetailPage(router.pathname.includes('/detail'))
  }, [router.pathname])

  const disabledKeys = isDetailPage ? ['MutiSelectItem'] : []

  return <Dropdown onOpenChange={e => onTrigger()}>
    <DropdownTrigger >
      <Icon onClick={onTrigger} className={`${className} text-desc hover:text-primary cursor-pointer hover:scale-1.3 transition-all`} icon="fluent:more-vertical-16-regular" width="16" height="16" />
    </DropdownTrigger>
    <DropdownMenu aria-label="Static Actions" disabledKeys={disabledKeys}>
      <DropdownItem key="EditItem" onPress={() => handleEdit(isDetailPage)}><EditItem /></DropdownItem>
      <DropdownItem key="MutiSelectItem" onPress={() => {
        handleMultiSelect()
      }}><MutiSelectItem /></DropdownItem>
      <DropdownItem key="ConvertItem" onPress={ConvertItemFunction}> <ConvertItem /></DropdownItem>
      <DropdownItem key="TopItem" onPress={handleTop}> <TopItem />  </DropdownItem>
      <DropdownItem key="ShareItem" onPress={handlePublic}> <PublicItem />  </DropdownItem>
      <DropdownItem key="ArchivedItem" onPress={handleArchived}>
        <ArchivedItem />
      </DropdownItem>

      {blinko.config.value?.isUseAI ? (
        <DropdownItem key="AITagItem" onPress={handleAITag}>
          <AITagItem />
        </DropdownItem>
      ) : <></>}

      {!blinko.curSelectedNote?.isRecycle ? (
        <DropdownItem key="TrashItem" onPress={handleTrash}>
          <TrashItem />
        </DropdownItem>
      ) : <></>}

      {blinko.curSelectedNote?.isRecycle ? (
        <DropdownItem key="DeleteItem" className="text-danger" onPress={handleDelete}>
          <DeleteItem />
        </DropdownItem>
      ) : <></>}
    </DropdownMenu>
  </Dropdown>
})