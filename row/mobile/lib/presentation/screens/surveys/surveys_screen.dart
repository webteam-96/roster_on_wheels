import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/survey_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

String _when(Object? iso) => DateFormatter.toDisplayWithTime(DateTime.tryParse(iso?.toString() ?? '')?.toLocal());

/// Surveys and polls the member is asked (gap #9): open ones first; tap to answer or see results.
class SurveysScreen extends StatefulWidget {
  const SurveysScreen({super.key, this.api});
  final SurveyApi? api;

  @override
  State<SurveysScreen> createState() => _SurveysScreenState();
}

class _SurveysScreenState extends State<SurveysScreen> {
  late final SurveyApi _api = widget.api ?? SurveyApi();
  List<Map<String, dynamic>>? _surveys;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final surveys = await _api.surveys();
      if (mounted) {
        setState(() {
          _surveys = surveys;
          _failed = false;
        });
      }
    } on ApiException {
      if (mounted) {
        setState(() {
          _surveys = const [];
          _failed = true;
        });
      }
    }
  }

  Future<void> _open(Map<String, dynamic> s) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SurveyScreen(id: s['id'] as int, api: _api)));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final surveys = _surveys;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Surveys'),
      body: surveys == null
          ? const LoadingWidget()
          : surveys.isEmpty
              ? EmptyStateWidget(
                  icon: Icons.poll_outlined,
                  title: _failed ? 'Could not load surveys' : 'No surveys',
                  subtitle: _failed ? 'Check your connection and pull to try again.' : 'You have no surveys to answer right now.')
              : RowRefresh(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [for (final s in surveys) _tile(s)],
                  ),
                ),
    );
  }

  Widget _tile(Map<String, dynamic> s) {
    final open = s['state'] == 'open';
    final answered = s['answered'] == true;
    final status = !open ? 'Closed' : (answered ? 'Answered' : 'Waiting for your answer');
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: Icon(answered || !open ? Icons.check_circle_outline : Icons.poll_outlined),
        title: Text(s['title'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text('$status\n${open ? 'Closes' : 'Closed'} ${_when(s['closesAt'])}'),
        isThreeLine: true,
        onTap: () => _open(s),
      ),
    );
  }
}

/// One survey: answer it (or change the answer while it is open), then see results when the survey shares them.
class SurveyScreen extends StatefulWidget {
  const SurveyScreen({super.key, required this.id, this.api});
  final int id;
  final SurveyApi? api;

  @override
  State<SurveyScreen> createState() => _SurveyScreenState();
}

class _SurveyScreenState extends State<SurveyScreen> {
  late final SurveyApi _api = widget.api ?? SurveyApi();
  Map<String, dynamic>? _survey;
  Map<String, dynamic>? _results;
  String? _error;
  bool _busy = false;
  // answers by question id: Set<int> for choices, int for rating, TextEditingController for text
  final Map<int, Object> _answers = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final a in _answers.values) {
      if (a is TextEditingController) a.dispose();
    }
    super.dispose();
  }

  List<Map<String, dynamic>> get _questions =>
      ((_survey?['questions'] as List?) ?? const []).cast<Map<String, dynamic>>();

  Future<void> _load() async {
    try {
      final s = await _api.survey(widget.id);
      Map<String, dynamic>? results;
      if (s['canSeeResults'] == true) results = await _api.results(widget.id);
      if (!mounted) return;
      final mine = {
        for (final a in ((s['myAnswers'] as List?) ?? const []).cast<Map<String, dynamic>>()) a['questionId'] as int: a
      };
      setState(() {
        _survey = s;
        _results = results;
        for (final q in _questions) {
          final id = q['id'] as int;
          final a = mine[id];
          _answers[id] = switch (q['type']) {
            'text' => (_answers[id] as TextEditingController?) ?? TextEditingController(text: a?['text'] as String? ?? ''),
            'rating' => (a?['rating'] as int?) ?? 0,
            _ => <int>{...((a?['choices'] as List?) ?? const []).cast<int>()},
          };
        }
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  List<Map<String, dynamic>> _body() => [
        for (final q in _questions)
          switch ((q['type'], _answers[q['id']])) {
            ('text', TextEditingController c) when c.text.trim().isNotEmpty => {'questionId': q['id'], 'text': c.text.trim()},
            ('rating', int r) when r > 0 => {'questionId': q['id'], 'rating': r},
            (_, Set<int> c) when c.isNotEmpty => {'questionId': q['id'], 'choices': c.toList()..sort()},
            _ => null,
          },
      ].whereType<Map<String, dynamic>>().toList();

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await _api.submit(widget.id, _body());
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, 'Thank you, your answers are saved');
      await _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _survey;
    return Scaffold(
      appBar: CustomAppBar(title: s?['title'] as String? ?? 'Survey'),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.poll_outlined, title: 'Survey not available', subtitle: _error!)
          : s == null
              ? const LoadingWidget()
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if ((s['description'] as String? ?? '').isNotEmpty)
                      Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(s['description'] as String)),
                    Text(
                      [
                        if (s['isAnonymous'] == true) 'Anonymous: no one sees who answered what.',
                        '${s['state'] == 'open' ? 'Closes' : 'Closed'} ${_when(s['closesAt'])}',
                      ].join('\n'),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 12),
                    if (s['state'] == 'open') ...[
                      for (final (i, q) in _questions.indexed) _question(i, q),
                      const SizedBox(height: 8),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: Text(s['answered'] == true ? 'Update my answers' : 'Send my answers'),
                      ),
                    ] else if (_results == null)
                      const Text('This survey is closed.'),
                    if (_results != null) ..._resultsView(_results!),
                  ],
                ),
    );
  }

  Widget _question(int i, Map<String, dynamic> q) {
    final id = q['id'] as int;
    final options = ((q['options'] as List?) ?? const []).cast<String>();
    final value = _answers[id];
    final label = '${i + 1}. ${q['text']}${q['required'] == true ? ' *' : ''}';
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            ...switch (q['type']) {
              'single' => [
                  RadioGroup<int>(
                    groupValue: (value as Set<int>).isEmpty ? null : value.first,
                    onChanged: (v) => setState(() => _answers[id] = {if (v != null) v}),
                    child: Column(children: [
                      for (final (j, o) in options.indexed)
                        RadioListTile<int>(contentPadding: EdgeInsets.zero, dense: true, title: Text(o), value: j),
                    ]),
                  ),
                ],
              'multiple' => [
                  for (final (j, o) in options.indexed)
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: Text(o),
                      value: (value as Set<int>).contains(j),
                      onChanged: (v) => setState(() => v == true ? value.add(j) : value.remove(j)),
                    ),
                ],
              'rating' => [
                  Wrap(spacing: 8, children: [
                    for (var r = 1; r <= 5; r++)
                      ChoiceChip(
                        label: Text('$r'),
                        selected: value == r,
                        onSelected: (_) => setState(() => _answers[id] = r),
                      ),
                  ]),
                ],
              _ => [
                  TextField(
                    controller: value as TextEditingController,
                    maxLines: 4,
                    maxLength: 2000,
                    decoration: const InputDecoration(border: OutlineInputBorder()),
                  ),
                ],
            },
          ],
        ),
      ),
    );
  }

  List<Widget> _resultsView(Map<String, dynamic> r) {
    final questions = ((r['questions'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return [
      const SizedBox(height: 16),
      Text('Results', style: Theme.of(context).textTheme.titleMedium),
      Text('${r['responseCount']} of ${r['audienceCount']} answered'),
      const SizedBox(height: 8),
      for (final q in questions)
        Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(q['text'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                if (q['type'] == 'rating' && q['ratingAverage'] != null) Text('Average ${q['ratingAverage']} of 5'),
                const SizedBox(height: 6),
                if (q['type'] == 'text')
                  for (final t in ((q['textAnswers'] as List?) ?? const []).cast<Map<String, dynamic>>())
                    Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(t['text'] as String? ?? ''))
                else
                  for (final o in ((q['options'] as List?) ?? const []).cast<Map<String, dynamic>>())
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${o['label']}  ${o['count']} (${o['percent']}%)'),
                          RowProgressBar(value: ((o['percent'] as num?) ?? 0) / 100, minHeight: 8),
                        ],
                      ),
                    ),
              ],
            ),
          ),
        ),
    ];
  }
}
