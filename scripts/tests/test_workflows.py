"""Structural assertions for bounded, opt-in and non-promoting automation."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def test_actions_are_immutable_and_jobs_bounded():
    workflows = list((ROOT/'.github/workflows').glob('*.yml'))
    assert len(workflows) == 4
    for path in workflows:
        content = path.read_text()
        for action in re.findall(r'uses:\s*([^\s]+)', content):
            assert re.fullmatch(r'actions/[\w-]+@[a-f0-9]{40}', action), action
        assert 'timeout-minutes:' in content
        assert 'contents: read' in content
        assert 'ubuntu-latest' in content
        assert 'retention-days: 7' in content or path.name == 'ci.yml'


def test_deploy_is_explicit_and_validates_actual_url():
    content = (ROOT/'.github/workflows/deploy.yml').read_text()
    assert 'workflow_dispatch:' in content
    assert 'default: false' in content
    assert 'if: inputs.confirm_experimental' in content
    assert content.index('Require provisioned') < content.index('Package the checked')
    assert 'scripts/smoke_deployment.py' in content
    assert 'pull_request_target' not in content


def test_training_never_automatically_promotes_or_publishes():
    content = (ROOT/'.github/workflows/train.yml').read_text()
    assert 'ASU_PARITY_DIR:' in content
    assert 'check_promotion_gate.py' in content
    assert '--allow-experimental-publish' not in content
    assert 'pages deploy' not in content
    maintenance = (ROOT/'.github/workflows/maintenance.yml').read_text()
    assert '--allow-source-update' not in maintenance
    assert '--retrain --timeout-seconds 300' in maintenance


def test_every_hosted_job_requires_explicit_budget_enablement():
    """Absent or false repository configuration must not allocate hosted runners."""
    guarded_jobs = 0
    for path in (ROOT/'.github/workflows').glob('*.yml'):
        content = path.read_text()
        jobs = content.split('\njobs:\n', 1)[1]
        for job in re.split(r'^  [\w-]+:\s*$', jobs, flags=re.M)[1:]:
            condition = re.search(r'^    if:\s*(.+)$', job, flags=re.M)
            assert condition and "vars.ASU_HOSTED_JOBS_ENABLED == 'true'" in condition.group(1), path
            assert condition.start() < job.index('    runs-on:'), path
            guarded_jobs += 1
    assert guarded_jobs == 5
