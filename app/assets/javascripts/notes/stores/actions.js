import Visibility from 'visibilityjs';
import Flash from '../../flash';
import Poll from '../../lib/utils/poll';
import * as types from './mutation_types';
import * as utils from './utils';
import * as constants from '../constants';
import service from '../services/issue_notes_service';
import loadAwardsHandler from '../../awards_handler';
import sidebarTimeTrackingEventHub from '../../sidebar/event_hub';
import { isInViewport, scrollToElement } from '../../lib/utils/common_utils';

let eTagPoll;

export const setNotesData = ({ commit }, data) => commit(types.SET_NOTES_DATA, data);
export const setIssueData = ({ commit }, data) => commit(types.SET_ISSUE_DATA, data);
export const setUserData = ({ commit }, data) => commit(types.SET_USER_DATA, data);
export const setLastFetchedAt = ({ commit }, data) => commit(types.SET_LAST_FETCHED_AT, data);
export const setInitialNotes = ({ commit }, data) => commit(types.SET_INITIAL_NOTES, data);
export const setTargetNoteHash = ({ commit }, data) => commit(types.SET_TARGET_NOTE_HASH, data);
export const toggleDiscussion = ({ commit }, data) => commit(types.TOGGLE_DISCUSSION, data);

export const fetchNotes = ({ commit }, path) => service
  .fetchNotes(path)
  .then(res => res.json())
  .then((res) => {
    commit(types.SET_INITIAL_NOTES, res);
  });

export const deleteNote = ({ commit }, note) => service
  .deleteNote(note.path)
  .then(() => {
    commit(types.DELETE_NOTE, note);
  });

export const updateNote = ({ commit }, { endpoint, note }) => service
  .updateNote(endpoint, note)
  .then(res => res.json())
  .then((res) => {
    commit(types.UPDATE_NOTE, res);
  });

export const replyToDiscussion = ({ commit }, { endpoint, data }) => service
  .replyToDiscussion(endpoint, data)
  .then(res => res.json())
  .then((res) => {
    commit(types.ADD_NEW_REPLY_TO_DISCUSSION, res);

    return res;
  });

export const createNewNote = ({ commit }, { endpoint, data }) => service
  .createNewNote(endpoint, data)
  .then(res => res.json())
  .then((res) => {
    if (!res.errors) {
      commit(types.ADD_NEW_NOTE, res);
    }
    return res;
  });

export const removePlaceholderNotes = ({ commit }) =>
  commit(types.REMOVE_PLACEHOLDER_NOTES);

export const saveNote = ({ commit, dispatch }, noteData) => {
  const { note } = noteData.data.note;
  let placeholderText = note;
  const hasQuickActions = utils.hasQuickActions(placeholderText);
  const replyId = noteData.data.in_reply_to_discussion_id;
  const methodToDispatch = replyId ? 'replyToDiscussion' : 'createNewNote';

  commit(types.REMOVE_PLACEHOLDER_NOTES); // remove previous placeholders
  $('.notes-form .flash-container').hide(); // hide previous flash notification

  if (hasQuickActions) {
    placeholderText = utils.stripQuickActions(placeholderText);
  }

  if (placeholderText.length) {
    commit(types.SHOW_PLACEHOLDER_NOTE, {
      noteBody: placeholderText,
      replyId,
    });
  }

  if (hasQuickActions) {
    commit(types.SHOW_PLACEHOLDER_NOTE, {
      isSystemNote: true,
      noteBody: utils.getQuickActionText(note),
      replyId,
    });
  }

  return dispatch(methodToDispatch, noteData)
    .then((res) => {
      const { errors } = res;
      const commandsChanges = res.commands_changes;

      if (hasQuickActions && errors && Object.keys(errors).length) {
        eTagPoll.makeRequest();

        $('.js-gfm-input').trigger('clear-commands-cache.atwho');
        Flash('Commands applied', 'notice', noteData.flashContainer);
      }

      if (commandsChanges) {
        if (commandsChanges.emoji_award) {
          const votesBlock = $('.js-awards-block').eq(0);

          loadAwardsHandler()
            .then((awardsHandler) => {
              awardsHandler.addAwardToEmojiBar(votesBlock, commandsChanges.emoji_award);
              awardsHandler.scrollToAwards();
            })
            .catch(() => {
              Flash(
                'Something went wrong while adding your award. Please try again.',
                'alert',
                noteData.flashContainer,
              );
            });
        }

        if (commandsChanges.spend_time != null || commandsChanges.time_estimate != null) {
          sidebarTimeTrackingEventHub.$emit('timeTrackingUpdated', res);
        }
      }

      if (errors && errors.commands_only) {
        Flash(errors.commands_only, 'notice', noteData.flashContainer);
      }
      commit(types.REMOVE_PLACEHOLDER_NOTES);

      return res;
    });
};

const pollSuccessCallBack = (resp, commit, state, getters) => {
  if (resp.notes && resp.notes.length) {
    const { notesById } = getters;

    resp.notes.forEach((note) => {
      if (notesById[note.id]) {
        commit(types.UPDATE_NOTE, note);
      } else if (note.type === constants.DISCUSSION_NOTE) {
        const discussion = utils.findNoteObjectById(state.notes, note.discussion_id);

        if (discussion) {
          commit(types.ADD_NEW_REPLY_TO_DISCUSSION, note);
        } else {
          commit(types.ADD_NEW_NOTE, note);
        }
      } else {
        commit(types.ADD_NEW_NOTE, note);
      }
    });
  }

  commit(types.SET_LAST_FETCHED_AT, resp.lastFetchedAt);

  return resp;
};

export const poll = ({ commit, state, getters }) => {
  const requestData = { endpoint: state.notesData.notesPath, lastFetchedAt: state.lastFetchedAt };

  eTagPoll = new Poll({
    resource: service,
    method: 'poll',
    data: requestData,
    successCallback: resp => resp.json()
      .then(data => pollSuccessCallBack(data, commit, state, getters)),
    errorCallback: () => Flash('Something went wrong while fetching latest comments.'),
  });

  if (!Visibility.hidden()) {
    eTagPoll.makeRequest();
  } else {
    service.poll(requestData);
  }

  Visibility.change(() => {
    if (!Visibility.hidden()) {
      eTagPoll.restart();
    } else {
      eTagPoll.stop();
    }
  });
};

export const stopPolling = () => {
  eTagPoll.stop();
};

export const restartPolling = () => {
  eTagPoll.restart();
};

export const fetchData = ({ commit, state, getters }) => {
  const requestData = { endpoint: state.notesData.notesPath, lastFetchedAt: state.lastFetchedAt };

  service.poll(requestData)
    .then(resp => resp.json)
    .then(data => pollSuccessCallBack(data, commit, state, getters))
    .catch(() => Flash('Something went wrong while fetching latest comments.'));
};

export const toggleAward = ({ commit, state, getters, dispatch }, { awardName, noteId }) => {
  commit(types.TOGGLE_AWARD, { awardName, note: getters.notesById[noteId] });
};

export const toggleAwardRequest = ({ commit, getters, dispatch }, data) => {
  const { endpoint, awardName } = data;

  return service
    .toggleAward(endpoint, { name: awardName })
    .then(res => res.json())
    .then(() => {
      dispatch('toggleAward', data);
    });
};

export const scrollToNoteIfNeeded = (context, el) => {
  if (!isInViewport(el[0])) {
    scrollToElement(el);
  }
};
